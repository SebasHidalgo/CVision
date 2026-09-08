import PageIntro from "@/components/layout/PageIntro";
import UploadForm from "./components/UploadForm";

const NOTES = [
  {
    index: "01",
    title: "Company and title",
    body: "They name this analysis and frame the mock interview later.",
  },
  {
    index: "02",
    title: "The description",
    body: "Paste all of it: requirements, responsibilities, nice-to-haves. The fuller the posting, the sharper the reading.",
  },
  {
    index: "03",
    title: "Your CV",
    body: "A PDF with a text layer, not a scan. It stays attached to the analysis so you can revisit it.",
  },
];

export default function ResumeUploadScreen() {
  return (
    <div className="wrap py-12 lg:py-16">
      <PageIntro
        eyebrow="New analysis"
        title="Measure your CV against one job."
        lede="One posting, one PDF. The verdict takes about a minute."
      />

      <div className="grid gap-12 pt-10 lg:grid-cols-12 lg:gap-16 lg:pt-14">
        <aside className="lg:col-span-4">
          <ol className="lg:sticky lg:top-28">
            {NOTES.map((note) => (
              <li
                key={note.index}
                className="grid grid-cols-[2.5rem_1fr] gap-x-4 border-t border-line py-5 last:border-b"
              >
                <span className="eyebrow pt-1 text-ink">{note.index}</span>
                <div>
                  <h2 className="font-medium text-ink">{note.title}</h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
                    {note.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </aside>

        <div className="lg:col-span-8">
          <UploadForm />
        </div>
      </div>
    </div>
  );
}
