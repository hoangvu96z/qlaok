/**
 * Normalizes an initial shop city value for settings form state.
 * Preserves absent or whitespace-only city values as empty strings ('')
 * so the optional selector starts unselected.
 */
export function resolveInitialSettingsCity(city?: string | null): string {
  if (!city) return '';
  return city.trim();
}

export interface ShopSettingsCityPatchInput {
  city: string;
  touched: boolean;
}

/**
 * Builds the city field patch for the shop settings general save payload.
 *
 * Rules:
 * - When untouched, city is omitted entirely from the patch so a missing or baseline
 *   city is never overwritten unintentionally (e.g. during a color-only save).
 * - When touched, explicit selection or clearing (empty string) is included.
 */
export function buildShopSettingsCityPatch(
  cityOrInput: string | ShopSettingsCityPatchInput,
  touchedArg?: boolean
): { city?: string } {
  let city: string;
  let touched: boolean;

  if (typeof cityOrInput === 'object' && cityOrInput !== null) {
    city = cityOrInput.city;
    touched = cityOrInput.touched;
  } else {
    city = cityOrInput;
    touched = Boolean(touchedArg);
  }

  if (!touched) {
    return {};
  }

  return { city: (city ?? '').trim() };
}
