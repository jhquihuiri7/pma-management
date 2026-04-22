const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { google } = require('googleapis');

const ROOT = process.cwd();

function loadEnvFromFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFromFile(path.join(ROOT, '.env.local'));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const db = admin.firestore();

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);

const DEFAULT_SUBSYSTEM = 'Sin proceso';

function normalizeFolderName(name, fallback) {
  const normalized = String(name || '').trim().replace(/[\\/]/g, '-');
  return normalized.length > 0 ? normalized : fallback;
}

function escapeDriveQueryLiteral(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function getAuthenticatedDrive(adminCollection, adminId) {
  const adminDoc = await db.collection(adminCollection).doc(adminId).get();
  if (!adminDoc.exists) throw new Error(`Admin not found: ${adminCollection}/${adminId}`);
  const data = adminDoc.data();

  oauth2Client.setCredentials({
    access_token: data.googleAccessToken,
    refresh_token: data.googleRefreshToken,
  });

  if ((data.tokenExpiresAt || 0) < Date.now()) {
    const { credentials } = await oauth2Client.refreshAccessToken();
    await db.collection(adminCollection).doc(adminId).update({
      googleAccessToken: credentials.access_token,
      tokenExpiresAt: credentials.expiry_date || Date.now() + 3600 * 1000,
    });
    oauth2Client.setCredentials(credentials);
  }

  return google.drive({ version: 'v3', auth: oauth2Client });
}

async function findFolder(drive, name, parentId) {
  const safeName = escapeDriveQueryLiteral(name);
  const safeParent = escapeDriveQueryLiteral(parentId);
  const res = await drive.files.list({
    q: `name='${safeName}' and '${safeParent}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id,name,parents)',
    pageSize: 1,
  });
  return res.data.files?.[0] || null;
}

async function createFolder(drive, name, parentId) {
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id,name,parents',
  });
  return res.data;
}

async function getOrCreateFolder(drive, name, parentId) {
  const existing = await findFolder(drive, name, parentId);
  if (existing?.id) return existing.id;
  const created = await createFolder(drive, name, parentId);
  return created.id;
}

async function moveFolderIfNeeded(drive, folderId, targetParentId) {
  const metadata = await drive.files.get({ fileId: folderId, fields: 'id,parents' });
  const currentParents = metadata.data.parents || [];
  if (currentParents.length === 1 && currentParents[0] === targetParentId) return false;

  const removeParents = currentParents.filter((p) => p !== targetParentId).join(',');
  await drive.files.update({
    fileId: folderId,
    addParents: targetParentId,
    ...(removeParents ? { removeParents } : {}),
    fields: 'id,parents',
  });
  return true;
}

async function migrateApp({
  appKey,
  adminCollection,
  planCollection,
  itemCollection,
}) {
  const adminSnap = await db.collection(adminCollection).get();

  const totals = {
    app: appKey,
    admins: adminSnap.size,
    plans: 0,
    plansUpdated: 0,
    itemsUpdated: 0,
    errors: 0,
  };

  for (const adminDoc of adminSnap.docs) {
    const adminId = adminDoc.id;
    const adminData = adminDoc.data();
    const rootFolderId = adminData.driveRootFolderId;
    if (!rootFolderId) continue;

    try {
      const drive = await getAuthenticatedDrive(adminCollection, adminId);
      const appFolderId = await getOrCreateFolder(drive, appKey, rootFolderId);

      const plansSnap = await db.collection(planCollection).where('adminId', '==', adminId).get();
      totals.plans += plansSnap.size;

      for (const planDoc of plansSnap.docs) {
        const plan = planDoc.data();
        const planId = plan.id || planDoc.id;

        try {
          const itemsSnap = await db.collection(itemCollection).where('planId', '==', planId).get();
          const firstItem = itemsSnap.docs[0]?.data() || null;
          const subsystemName = normalizeFolderName(firstItem?.subplan || DEFAULT_SUBSYSTEM, DEFAULT_SUBSYSTEM);
          const subsystemFolderId = await getOrCreateFolder(drive, subsystemName, appFolderId);

          let planFolderId = plan.driveFolderId;
          let planChanged = false;

          if (planFolderId) {
            const moved = await moveFolderIfNeeded(drive, planFolderId, subsystemFolderId);
            if (moved) planChanged = true;
          } else {
            planFolderId = await getOrCreateFolder(drive, normalizeFolderName(plan.title, 'Plan'), subsystemFolderId);
            planChanged = true;
          }

          if (planChanged || plan.driveFolderId !== planFolderId) {
            await planDoc.ref.update({ driveFolderId: planFolderId });
            totals.plansUpdated += 1;
          }

          for (const itemDoc of itemsSnap.docs) {
            const item = itemDoc.data();
            let itemFolderId = item.driveFolderId;
            let itemChanged = false;

            if (itemFolderId) {
              const moved = await moveFolderIfNeeded(drive, itemFolderId, planFolderId);
              if (moved) itemChanged = true;
            } else {
              itemFolderId = await getOrCreateFolder(
                drive,
                normalizeFolderName(item.item, 'Item'),
                planFolderId
              );
              itemChanged = true;
            }

            if (itemChanged || item.driveFolderId !== itemFolderId) {
              await itemDoc.ref.update({ driveFolderId: itemFolderId });
              totals.itemsUpdated += 1;
            }
          }
        } catch (planError) {
          totals.errors += 1;
          console.error(`[${appKey}] plan error admin=${adminId} plan=${planId}:`, planError.message || planError);
        }
      }
    } catch (adminError) {
      totals.errors += 1;
      console.error(`[${appKey}] admin error admin=${adminId}:`, adminError.message || adminError);
    }
  }

  return totals;
}

(async () => {
  const results = [];

  results.push(
    await migrateApp({
      appKey: 'PMA',
      adminCollection: 'pma_admins',
      planCollection: 'pma_plans',
      itemCollection: 'pma_planItems',
    })
  );

  results.push(
    await migrateApp({
      appKey: 'RGDP',
      adminCollection: 'rgdp_admins',
      planCollection: 'rgdp_projects',
      itemCollection: 'rgdp_projectItems',
    })
  );

  console.log(JSON.stringify({ ok: true, results }, null, 2));
})().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message || String(err) }, null, 2));
  process.exit(1);
});
