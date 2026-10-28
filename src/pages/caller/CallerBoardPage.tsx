import { useCaller } from "../../contexts/CallerContext";

// Placeholder until the scoped Kanban lands (build step 7).
export default function CallerBoardPage() {
  const { caller } = useCaller();
  return (
    <div className="p-6 sm:p-8">
      <h1 className="text-lg font-semibold text-white">Hi {caller?.name.split(" ")[0]}</h1>
      <p className="text-sm text-gray-400 mt-1">Your assigned leads will appear here.</p>
    </div>
  );
}
