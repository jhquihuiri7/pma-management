import { adminDb } from "@/lib/firebase-admin";
import { Finding, FindingComponent } from "@/types";

function toLocalIsoString(date: Date): string {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 19);
}

export async function createFinding(
  planId: string,
  data: {
    component: FindingComponent;
    nudosCriticos: string;
    alarmas: string;
    riesgos: string;
    propuestasSolucion: string;
    createdByName: string;
  }
): Promise<Finding> {
  const ref = adminDb.collection("pma_findings").doc();
  const now = new Date();

  const finding: Finding = {
    id: ref.id,
    planId,
    component: data.component,
    nudosCriticos: data.nudosCriticos,
    alarmas: data.alarmas,
    riesgos: data.riesgos,
    propuestasSolucion: data.propuestasSolucion,
    createdByName: data.createdByName,
    createdAt: toLocalIsoString(now),
  };

  await ref.set(finding);
  return finding;
}

export async function getFindingsByPlan(planId: string): Promise<Finding[]> {
  const snapshot = await adminDb
    .collection("pma_findings")
    .where("planId", "==", planId)
    .orderBy("createdAt", "desc")
    .get();

  return snapshot.docs.map((doc) => doc.data() as Finding);
}

export async function updateFinding(
  findingId: string,
  planId: string,
  data: {
    component: FindingComponent;
    nudosCriticos: string;
    alarmas: string;
    riesgos: string;
    propuestasSolucion: string;
  }
): Promise<void> {
  const ref = adminDb.collection("pma_findings").doc(findingId);
  const doc = await ref.get();
  if (!doc.exists) throw new Error("Finding not found");
  const finding = doc.data() as Finding;
  if (finding.planId !== planId) throw new Error("Unauthorized");

  await ref.update({
    component: data.component,
    nudosCriticos: data.nudosCriticos,
    alarmas: data.alarmas,
    riesgos: data.riesgos,
    propuestasSolucion: data.propuestasSolucion,
  });
}

export async function deleteFinding(
  findingId: string,
  planId: string
): Promise<void> {
  const ref = adminDb.collection("pma_findings").doc(findingId);
  const doc = await ref.get();
  if (!doc.exists) throw new Error("Finding not found");
  const finding = doc.data() as Finding;
  if (finding.planId !== planId) throw new Error("Unauthorized");
  await ref.delete();
}
