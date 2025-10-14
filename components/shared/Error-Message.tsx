export default function ErrorMessage({ text }: { text: string }) {
  return <span className="text-red-500 text-sm">{text}</span>;
}
