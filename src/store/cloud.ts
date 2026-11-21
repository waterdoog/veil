import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { firestore } from "../firebase";
import type { Analysis, Synthesis } from "../ai/backend";

/**
 * Firestore stores only what already passed the airlock: pseudonymised text and the cloud's analysis.
 * The codebook and raw transcript are never written here.
 */
export async function saveInterview(
  uid: string,
  studyId: string,
  interview: { id: string; title: string; redacted: string; analysis?: Analysis; policy: string },
): Promise<void> {
  const db = firestore();
  if (!db) return;
  await setDoc(
    doc(db, "users", uid, "studies", studyId, "interviews", interview.id),
    {
      title: interview.title,
      redacted: interview.redacted,
      analysis: interview.analysis ?? null,
      policy: interview.policy,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function saveSynthesis(uid: string, studyId: string, name: string, synthesis: Synthesis): Promise<void> {
  const db = firestore();
  if (!db) return;
  await setDoc(
    doc(db, "users", uid, "studies", studyId),
    { name, synthesis, updatedAt: serverTimestamp() },
    { merge: true },
  );
}
