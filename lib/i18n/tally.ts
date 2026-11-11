import type { TFunction } from "i18next";
import type { RequirementTally } from "@/lib/schemas/resumeSchema";

/** "2 of 2 required, 2 of 4 preferred": the verdict's arithmetic, in the interface language. */
export function tallyCopy(t: TFunction<"common">, tally: RequirementTally): string {
  const part = (label: "required" | "preferred", count: RequirementTally["required"]) =>
    count.partial
      ? t("tally.partWithPartial", { met: count.met, total: count.total, partial: count.partial, label: t(`tally.${label}`) })
      : t("tally.part", { met: count.met, total: count.total, label: t(`tally.${label}`) });
  const notShown = tally.required.notShown + tally.preferred.notShown;
  const required = part("required", tally.required);
  const preferred = part("preferred", tally.preferred);
  return notShown
    ? t("tally.joinedWithNotShown", { required, preferred, notShown: t("tally.notShown", { count: notShown }) })
    : t("tally.joined", { required, preferred });
}
