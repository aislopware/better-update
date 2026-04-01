import { Button } from "@better-update/ui/components/ui/button";
import { createFileRoute } from "@tanstack/react-router";

const Home = () => (
  <div className="flex min-h-screen items-center justify-center gap-4">
    <Button>Default</Button>
    <Button variant="outline">Outline</Button>
    <Button variant="secondary">Secondary</Button>
    <Button variant="destructive">Destructive</Button>
  </div>
);

export const Route = createFileRoute("/")({
  component: Home,
});
