/** A delayed storage read must never overwrite a choice made in this session. */
export function shouldApplyPersistedLocale(
  mounted: boolean,
  userSelected: boolean,
): boolean {
  return mounted && !userSelected;
}
