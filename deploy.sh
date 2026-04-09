#!/bin/bash
set -e

# ─── CONFIG ───────────────────────────────────────────────────────────────────
PROJECT_ID="pma-management1"
SERVICE_NAME="pma-management"
REGION="us-central1"
IMAGE="gcr.io/$PROJECT_ID/$SERVICE_NAME"
# ──────────────────────────────────────────────────────────────────────────────

echo "Building Docker image..."
docker build -t "$IMAGE" .

echo "Pushing image to Container Registry..."
docker push "$IMAGE"

echo "Deploying to Cloud Run..."
gcloud run deploy "$SERVICE_NAME" \
  --image "$IMAGE" \
  --platform managed \
  --region "$REGION" \
  --allow-unauthenticated \
  --port 3000 \
  --set-env-vars "NEXTAUTH_URL=https://$SERVICE_NAME-<HASH>-uc.a.run.app" \
  --set-env-vars "NEXTAUTH_SECRET=CHANGE_ME_GENERATE_WITH_openssl_rand_base64_32" \
  --set-env-vars "GOOGLE_CLIENT_ID=YOUR_GOOGLE_CLIENT_ID" \
  --set-env-vars "GOOGLE_CLIENT_SECRET=YOUR_GOOGLE_CLIENT_SECRET" \
  --set-env-vars "NEXT_PUBLIC_FIREBASE_API_KEY=YOUR_FIREBASE_API_KEY" \
  --set-env-vars "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=pma-management1.firebaseapp.com" \
  --set-env-vars "NEXT_PUBLIC_FIREBASE_PROJECT_ID=pma-management1" \
  --set-env-vars "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=pma-management1.firebasestorage.app" \
  --set-env-vars "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=960495103085" \
  --set-env-vars "NEXT_PUBLIC_FIREBASE_APP_ID=1:960495103085:web:aee9e076ca97ed80772364" \
  --set-env-vars "FIREBASE_ADMIN_PROJECT_ID=pma-management1" \
  --set-env-vars "FIREBASE_ADMIN_CLIENT_EMAIL=firebase-adminsdk-fbsvc@pma-management1.iam.gserviceaccount.com" \
  --set-env-vars "^||^FIREBASE_ADMIN_PRIVATE_KEY=YOUR_FIREBASE_ADMIN_PRIVATE_KEY"

echo ""
echo "Deploy complete. Get the service URL with:"
echo "  gcloud run services describe $SERVICE_NAME --region $REGION --format='value(status.url)'"
