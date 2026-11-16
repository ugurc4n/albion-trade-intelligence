import { AppShell } from "@/components/app-shell";

/** Every page except the in-game overlay gets the sidebar and header. */
export default function MainLayout({ children }: LayoutProps<"/">) {
  return <AppShell>{children}</AppShell>;
}
