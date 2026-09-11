// The harness never touches Firestore: Shared modules that import '../../firebase' get empty handles.
export const db = {}; export const appCheck = null; export const auth = null; export default {};
