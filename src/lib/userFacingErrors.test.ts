import { describe, expect, it } from "vitest";
import { getUserFacingErrorMessage } from "./userFacingErrors";

describe("getUserFacingErrorMessage", () => {
  it("maps inactive subscription errors to a clear activation message", () => {
    expect(getUserFacingErrorMessage("Subscription access inactive")).toBe(
      "Votre compte est connecte, mais aucun abonnement actif n'a ete detecte. Ouvrez votre abonnement pour activer Vocalype.",
    );
  });

  it("maps failed activation errors to a clear retry message", () => {
    expect(getUserFacingErrorMessage("Activation failed")).toBe(
      "Votre compte est connecte, mais l'activation sur ce PC a echoue. Reessayez ou ouvrez votre abonnement.",
    );
  });
});
