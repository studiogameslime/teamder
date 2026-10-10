/** A read that stalls cannot hold every newer invitation hostage. On timeout
 * navigate optimistically; the destination owns its loading/access errors. */
export async function invitePreflight(read: () => Promise<unknown>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read().then((value) => value !== null),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(true), 4000); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}
