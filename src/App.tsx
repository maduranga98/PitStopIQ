import { useState } from "react";
import "./App.css";

function App() {
  const [count, setCount] = useState(0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-lg shadow-xl p-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Welcome to PitstopIQ
          </h1>
          <p className="text-gray-600 mb-8">
            React 18 + TypeScript + Tailwind CSS + shadcn/ui
          </p>

          <div className="space-y-6">
            <div className="p-6 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-lg text-white">
              <h2 className="text-2xl font-semibold mb-2">Getting Started</h2>
              <p className="mb-4">
                You now have a fully configured React + TypeScript + Tailwind +
                shadcn/ui project!
              </p>
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setCount((count) => count + 1)}
                className="flex-1 px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors"
              >
                Counter: {count}
              </button>
              <button
                onClick={() => setCount(0)}
                className="flex-1 px-6 py-3 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition-colors"
              >
                Reset
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-8">
              <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                <h3 className="font-semibold text-blue-900 mb-2">React 18</h3>
                <p className="text-sm text-blue-700">Latest React features</p>
              </div>
              <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
                <h3 className="font-semibold text-purple-900 mb-2">
                  TypeScript
                </h3>
                <p className="text-sm text-purple-700">Type-safe code</p>
              </div>
              <div className="p-4 bg-cyan-50 rounded-lg border border-cyan-200">
                <h3 className="font-semibold text-cyan-900 mb-2">
                  Tailwind CSS
                </h3>
                <p className="text-sm text-cyan-700">Utility-first styling</p>
              </div>
              <div className="p-4 bg-orange-50 rounded-lg border border-orange-200">
                <h3 className="font-semibold text-orange-900 mb-2">
                  shadcn/ui
                </h3>
                <p className="text-sm text-orange-700">Component library</p>
              </div>
            </div>

            <div className="mt-8 p-4 bg-gray-50 rounded-lg border border-gray-200">
              <h3 className="font-semibold text-gray-900 mb-2">Next Steps</h3>
              <ul className="text-sm text-gray-700 space-y-1">
                <li>✓ Edit src/App.tsx to customize your app</li>
                <li>✓ Run `npm run dev` to start the development server</li>
                <li>✓ Use shadcn/ui components from the CLI or manually</li>
                <li>✓ Build with Tailwind CSS utility classes</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
