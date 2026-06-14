# PitstopIQ - React 18 + TypeScript + Tailwind CSS + shadcn/ui

A modern, fully configured React project with TypeScript, Tailwind CSS, and shadcn/ui components.

## Project Stack

- **React 18** - Latest React features and hooks
- **TypeScript** - Type-safe JavaScript development
- **Vite** - Lightning-fast build tool and dev server
- **Tailwind CSS** - Utility-first CSS framework
- **shadcn/ui** - High-quality React components built on Radix UI
- **PostCSS & Autoprefixer** - CSS processing for better compatibility

## Getting Started

### Development Server

Start the development server:

```bash
npm run dev
```

The app will be available at `http://localhost:5173`

### Building for Production

Build the project for production:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Using shadcn/ui Components

### Option 1: Using the CLI (Recommended)

Add components using the shadcn/ui CLI:

```bash
npx shadcn-ui@latest add button
npx shadcn-ui@latest add card
npx shadcn-ui@latest add dialog
```

### Option 2: Copy Paste

Visit [shadcn/ui](https://ui.shadcn.com/docs/components/) and copy the component code into `src/components/ui/`

### Using Components in Your App

```tsx
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function MyComponent() {
  return (
    <Card>
      <Button>Click me</Button>
    </Card>
  );
}
```

## Project Structure

```
src/
├── App.tsx           # Main app component
├── App.css           # App styles
├── index.css         # Global styles (Tailwind directives)
├── main.tsx          # Entry point
├── components/
│   └── ui/          # shadcn/ui components
└── assets/          # Static assets

Configuration Files:
├── vite.config.ts    # Vite configuration with path alias
├── tsconfig.json     # TypeScript configuration
├── tailwind.config.js # Tailwind CSS configuration
├── postcss.config.js # PostCSS configuration
└── components.json   # shadcn/ui configuration
```

## Tailwind CSS

Tailwind CSS is fully configured. Use utility classes directly in your components:

```tsx
<div className="flex items-center justify-center min-h-screen bg-gray-100">
  <h1 className="text-4xl font-bold text-blue-600">Hello World</h1>
</div>
```

## TypeScript

TypeScript is configured for strict type checking. All React components should be properly typed:

```tsx
interface Props {
  title: string;
  count: number;
  onIncrement: () => void;
}

function Counter({ title, count, onIncrement }: Props) {
  return (
    <div>
      <h1>{title}</h1>
      <button onClick={onIncrement}>{count}</button>
    </div>
  );
}
```

## Path Alias

The `@/` alias is configured to point to `src/`:

```tsx
// Instead of: import Button from '../../../components/ui/button'
import Button from "@/components/ui/button"; // ✓ Cleaner!
```

## ESLint

The project comes with ESLint configured. Run linting:

```bash
npm run lint
```

## Next Steps

1. **Add Components**: Start adding shadcn/ui components for your UI
2. **Create Pages**: Build your app's pages and layouts
3. **Style Components**: Use Tailwind CSS classes for styling
4. **Type Your Code**: Leverage TypeScript for better development experience
5. **Deploy**: Build and deploy to your hosting platform

## Useful Resources

- [React Documentation](https://react.dev)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [shadcn/ui Documentation](https://ui.shadcn.com/docs)
- [Vite Documentation](https://vitejs.dev/)

## License

MIT
