const admin = require('firebase-admin');

const EMAIL_WHITELIST = ['mdmntungwa@gmail.com'];

// Initialize with default credentials or service account
if (!admin.apps.length) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : null;

  if (serviceAccount) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  } else {
    admin.initializeApp({ projectId: 'hilbert-talk' });
  }
}

async function verifyToken(idToken) {
  if (!idToken) throw new Error('No token provided');

  const decoded = await admin.auth().verifyIdToken(idToken);

  if (!decoded.email) {
    throw new Error('No email in token');
  }

  if (!EMAIL_WHITELIST.includes(decoded.email)) {
    throw new Error(`Email not whitelisted: ${decoded.email}`);
  }

  return decoded;
}

module.exports = { verifyToken, EMAIL_WHITELIST };
