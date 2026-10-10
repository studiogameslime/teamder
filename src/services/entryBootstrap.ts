// One launch, one invitation bootstrap. The entry gate waits only up to 4.5s.
let complete!: () => void;
const ready = new Promise<void>((resolve) => { complete = resolve; });
export function finishEntryBootstrap(): void { complete(); }
export async function waitForEntryBootstrap(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([ready, new Promise<void>((resolve) => {
      timer = setTimeout(resolve, 4500);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
