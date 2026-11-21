import { initializeApp, type FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import { getAuth, onAuthStateChanged, signInAnonymously, type User } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, type Firestore } from "firebase/firestore";
import { fetchAndActivate, getRemoteConfig, getValue, type RemoteConfig } from "firebase/remote-config";

const env = import.meta.env;

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

export const isConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);

/** Values the team can change without a redeploy (Firebase Remote Config). */
export interface RuntimeConfig {
  cloudModel: string;
  defaultPolicy: "strict" | "standard";
  chunkChars: number;
}

export const RC_DEFAULTS: RuntimeConfig = {
  cloudModel: "gemini-3.8-flash",
  defaultPolicy: "standard",
  chunkChars: 3500,
};

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let rc: RemoteConfig | null = null;

export function firebaseApp(): FirebaseApp {
  if (!app) throw new Error("Firebase is not configured. Copy .env.example to .env and fill it in.");
  return app;
}

export function firestore(): Firestore | null {
  return db;
}

export function initFirebase(): void {
  if (!isConfigured || app) return;
  app = initializeApp(firebaseConfig);

  // Firebase AI Logic requires App Check. Local development uses the debug provider:
  // the SDK prints a debug token in the console, which you register in the Firebase console.
  if (env.DEV || !env.VITE_RECAPTCHA_SITE_KEY) {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(env.VITE_RECAPTCHA_SITE_KEY || "debug-provider-in-use"),
    isTokenAutoRefreshEnabled: true,
  });

  // Firestore holds only pseudonymised text and analysis. Offline cache lets the app keep
  // working on a train; writes sync when the connection returns.
  db = initializeFirestore(app, { localCache: persistentLocalCache() });

  rc = getRemoteConfig(app);
  rc.settings.minimumFetchIntervalMillis = env.DEV ? 60_000 : 3_600_000;
  rc.defaultConfig = {
    cloud_model: RC_DEFAULTS.cloudModel,
    default_policy: RC_DEFAULTS.defaultPolicy,
    chunk_chars: RC_DEFAULTS.chunkChars,
  };
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  if (!rc) return RC_DEFAULTS;
  try {
    await fetchAndActivate(rc);
  } catch {
    // offline or not set up: defaults are fine
  }
  const policy = getValue(rc, "default_policy").asString();
  return {
    cloudModel: getValue(rc, "cloud_model").asString() || RC_DEFAULTS.cloudModel,
    defaultPolicy: policy === "strict" ? "strict" : "standard",
    chunkChars: getValue(rc, "chunk_chars").asNumber() || RC_DEFAULTS.chunkChars,
  };
}

export function watchUser(cb: (u: User | null) => void): () => void {
  if (!app) {
    cb(null);
    return () => {};
  }
  const auth = getAuth(app);
  const off = onAuthStateChanged(auth, (u) => {
    if (u) cb(u);
    else signInAnonymously(auth).catch(() => cb(null));
  });
  return off;
}
