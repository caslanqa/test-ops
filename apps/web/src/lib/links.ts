import { ApiError, api } from '../api/client';

/**
 * Unlinks a case from a plan or requirement. A 404 means the link is already gone (an earlier,
 * partly failed save removed it), which is the state the caller wants, so it is not an error.
 */
export async function removeLink(path: string): Promise<void> {
  try {
    await api.delete(path);
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 404)) throw err;
  }
}
