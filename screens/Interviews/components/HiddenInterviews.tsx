"use client";

import { useTranslation } from "react-i18next";
import { deletionSummary } from "@/components/history/deletionSummary";
import { HiddenBlock, type HiddenRow } from "@/components/history/HiddenBlock";
import { useErrorCopy } from "@/hooks/useErrorCopy";
import { deleteHiddenInterviewsAction } from "@/screens/Interviews/actions/deleteHiddenInterviewsAction";
import { deleteOneInterviewAction } from "@/screens/Interviews/actions/deleteOneInterviewAction";

/** One hidden interview as the list shows it: role, company and date, never opened. Dates come formatted from the server. */
export type HiddenInterviewItem = {
  id: string;
  /** Its place in the whole list ("04"), continuing the visible list's numbering. */
  n: string;
  role: string;
  companyName: string;
  date: string;
  dateTime: string;
};

const SUMMARY_KEY = {
  deleted: "list.hidden.result.deleted",
  busy: "list.hidden.result.busy",
  failed: "list.hidden.result.failed",
  remaining: "list.hidden.result.remaining",
  unchanged: "list.hidden.result.unchanged",
} as const;

/**
 * The interviews of analyses Free's history rule hides, in the shared hidden block: their room and feedback page don't
 * open, so this is the only place to delete them (transcript, feedback and the calls at the voice platform).
 */
export function HiddenInterviews({ items, limit }: { items: HiddenInterviewItem[]; limit: number }) {
  const { t } = useTranslation("interview");
  const errorCopy = useErrorCopy();

  const rows: HiddenRow[] = items.map((item) => {
    const named = { role: item.role, companyName: item.companyName, date: item.date };
    return {
      id: item.id,
      n: item.n,
      company: item.companyName,
      title: item.role,
      date: item.date,
      dateTime: item.dateTime,
      deleteLabel: t("list.hidden.deleteLabel", named),
      confirm: {
        title: t("list.hidden.confirm.oneTitle"),
        body: t("list.hidden.confirm.oneBody", named),
        confirmLabel: t("list.hidden.confirm.oneConfirm"),
        cancelLabel: t("list.hidden.confirm.keep"),
      },
    };
  });

  const deleteOne = async (row: HiddenRow) => {
    try {
      const result = await deleteOneInterviewAction({ interviewId: row.id });
      return result.ok ? t("list.hidden.result.deletedOne", { role: row.title, companyName: row.company }) : errorCopy(result.code, result.meta);
    } catch {
      return errorCopy("REQUEST_FAILED");
    }
  };

  const deleteAll = async () => {
    try {
      const result = await deleteHiddenInterviewsAction({ ids: items.map((item) => item.id) });
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
      kind="interviews"
      title={t("list.hidden.title", { count: items.length })}
      why={t("list.hidden.why", { limit })}
      seePro={t("list.hidden.seePro")}
      listLabel={t("list.hidden.listLabel")}
      deleteRow={t("list.hidden.delete")}
      deleteAll={{
        label: t("list.hidden.deleteAll", { count: items.length }),
        confirm: {
          title: t("list.hidden.confirm.allTitle", { count: items.length }),
          body: t("list.hidden.confirm.allBody"),
          confirmLabel: t("list.hidden.confirm.allConfirm", { count: items.length }),
          cancelLabel: t("list.hidden.confirm.keepAll"),
        },
      }}
      pendingLabel={t("list.hidden.confirm.deleting")}
      rows={rows}
      onDeleteOne={deleteOne}
      onDeleteAll={deleteAll}
    />
  );
}
