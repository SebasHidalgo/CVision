"use client";

import { useTranslation } from "react-i18next";
import { deletionSummary } from "@/components/history/deletionSummary";
import { HiddenBlock, type HiddenRow } from "@/components/history/HiddenBlock";
import { useErrorCopy } from "@/hooks/useErrorCopy";
import { deleteHiddenAnalysesAction } from "@/screens/ResumeAnalyses/actions/deleteHiddenAnalysesAction";
import { deleteOneAnalysisAction } from "@/screens/ResumeAnalyses/actions/deleteOneAnalysisAction";

/** One hidden analysis as the list shows it: told apart, never opened. Dates come formatted from the server. */
export type HiddenItem = {
  id: string;
  /** Its place in the whole history ("04"), continuing the visible list's numbering. */
  n: string;
  jobTitle: string;
  companyName: string;
  date: string;
  dateTime: string;
  /** Its interviews, which deleting it takes along: the confirmation names them. */
  interviews: number;
};

const SUMMARY_KEY = {
  deleted: "result.deleted",
  busy: "result.busy",
  failed: "result.failed",
  remaining: "result.remaining",
  unchanged: "result.unchanged",
} as const;

/** The analyses Free's history rule hides, in the shared hidden block: their pages show the upgrade notice. */
export function HiddenAnalyses({ items, limit }: { items: HiddenItem[]; limit: number }) {
  const { t } = useTranslation("analyses");
  const errorCopy = useErrorCopy();
  const interviews = items.reduce((sum, item) => sum + item.interviews, 0);

  const rows: HiddenRow[] = items.map((item) => {
    const named = { jobTitle: item.jobTitle, companyName: item.companyName, date: item.date };
    return {
      id: item.id,
      n: item.n,
      company: item.companyName,
      title: item.jobTitle,
      date: item.date,
      dateTime: item.dateTime,
      deleteLabel: t("row.deleteLabel", named),
      confirm: {
        title: t("confirm.oneTitle"),
        body: item.interviews > 0 ? t("confirm.oneBodyInterviews", { ...named, count: item.interviews }) : t("confirm.oneBody", named),
        confirmLabel: t("confirm.oneConfirm"),
        cancelLabel: t("confirm.keep"),
      },
    };
  });

  const deleteOne = async (row: HiddenRow) => {
    try {
      const result = await deleteOneAnalysisAction({ resumeId: row.id });
      return result.ok ? t("result.deletedOne", { jobTitle: row.title, companyName: row.company }) : errorCopy(result.code, result.meta);
    } catch {
      return errorCopy("REQUEST_FAILED");
    }
  };

  const deleteAll = async () => {
    try {
      const result = await deleteHiddenAnalysesAction({ ids: items.map((item) => item.id) });
      if (!result.ok) return errorCopy(result.code, result.meta);
      return deletionSummary(result.data)
        .map((part) => ("count" in part ? t(SUMMARY_KEY[part.kind], { count: part.count }) : t(SUMMARY_KEY[part.kind])))
        .join(" ");
    } catch {
      return errorCopy("REQUEST_FAILED");
    }
  };

  return (
    <HiddenBlock
      kind="analyses"
      title={t("hidden.title", { count: items.length })}
      why={t("hidden.why", { limit })}
      seePro={t("hidden.seePro")}
      listLabel={t("hidden.listLabel")}
      deleteRow={t("row.delete")}
      deleteAll={{
        label: t("hidden.deleteAll", { count: items.length }),
        confirm: {
          title: t("confirm.allTitle", { count: items.length }),
          body: interviews > 0 ? t("confirm.allBodyInterviews", { count: interviews, limit }) : t("confirm.allBody", { limit }),
          confirmLabel: t("confirm.allConfirm", { count: items.length }),
          cancelLabel: t("confirm.keepAll"),
        },
      }}
      pendingLabel={t("confirm.deleting")}
      rows={rows}
      onDeleteOne={deleteOne}
      onDeleteAll={deleteAll}
    />
  );
}
