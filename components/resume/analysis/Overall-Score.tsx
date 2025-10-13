interface OverallScoreProps {
  score: number;
}

export default function OverallScore({ score }: OverallScoreProps) {
  return (
    <div className="flex w-full">
      <div className="flex items-center mx-auto gap-6">
        <div className="relative">
          <svg className="w-32 h-32 transform -rotate-90">
            <circle
              cx="64"
              cy="64"
              r="56"
              stroke="currentColor"
              strokeWidth="8"
              fill="none"
              className="text-muted"
            />
            <circle
              cx="64"
              cy="64"
              r="56"
              stroke="url(#gradient)"
              strokeWidth="8"
              fill="none"
              strokeDasharray={`${(score / 100) * 351.86} 351.86`}
              strokeLinecap="round"
            />
            <defs>
              <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="oklch(0.65 0.25 270)" />
                <stop offset="100%" stopColor="oklch(0.75 0.20 300)" />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-bold text-foreground">
              {score}/100
            </span>
          </div>
        </div>

        <div className="flex-1">
          <h3 className="text-lg font-semibold text-foreground mb-2">
            Your Resume Score
          </h3>
          <p className="text-sm text-muted-foreground">
            This score is calculated based on the variables listed below
          </p>
        </div>
      </div>
    </div>
  );
}
