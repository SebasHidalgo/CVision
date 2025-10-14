import { Card } from "@/components/ui/card";
import { SquareArrowOutUpRight } from "lucide-react";
import Link from "next/link";

interface PdfPreviewCardProps {
  resumeUrl: string;
}

export default function PdfPreviewCard({ resumeUrl }: PdfPreviewCardProps) {
  return (
    <Card className="p-6 bg-card/50 border-border/50">
      <div className="flex items-center gap-2">
        <h2 className="text-2xl font-semibold text-foreground">
          Resume Preview
        </h2>
        <Link href={resumeUrl} target="_blank" rel="noopener noreferrer">
          <SquareArrowOutUpRight className="w-5 h-5 cursor-pointer hover:text-primary transition-colors" />
        </Link>
      </div>
      <object
        data={`${resumeUrl}#view=FitH`}
        type="application/pdf"
        className="w-full h-[600px] z-50"
        aria-label="Resume Preview"
      ></object>
    </Card>
  );
}
