/**
 * Welche Enterprise-Funktionen die Middleware gerade freischaltet
 * (GET /api/features, siehe server/app.ts). Die Extension richtet ihre
 * Oberfläche danach aus: Ohne Lizenz erscheinen Memory und gespeicherte
 * Abfragen gar nicht, statt anzubieten, was beim Speichern scheitern würde.
 * Dashboard-Aktionen ("actions") werden ohne Lizenz aus Vorschlägen gefiltert
 * und lassen sich auch nicht ausführen — Defense in Depth zum serverseitigen
 * Gate im System-Prompt.
 */
export interface EeFeatures {
  sso: boolean;
  memory: boolean;
  savedQueries: boolean;
  actions: boolean;
}

export const NO_EE_FEATURES: EeFeatures = { sso: false, memory: false, savedQueries: false, actions: false };

export async function fetchFeatures(baseUrl: string, apiToken?: string): Promise<EeFeatures> {
  try {
    const res = await fetch(`${baseUrl}/api/features`, {
      headers: apiToken ? { authorization: `Bearer ${apiToken}` } : {},
    });
    if (!res.ok) return NO_EE_FEATURES;
    const data = (await res.json()) as { features?: Partial<EeFeatures> };
    return {
      sso: data.features?.sso === true,
      memory: data.features?.memory === true,
      savedQueries: data.features?.savedQueries === true,
      actions: data.features?.actions === true,
    };
  } catch {
    // Nicht erreichbar: wie "keine Lizenz" behandeln — der Chat selbst läuft weiter.
    return NO_EE_FEATURES;
  }
}
