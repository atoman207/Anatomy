import Link from "next/link";
import { Card } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";

const LINKS: { href: string; title: string; icon: IconName }[] = [
  { href: "/organize", title: "データ整理", icon: "folder" },
  { href: "/analyze", title: "統計・図", icon: "chart" },
  { href: "/voice", title: "音声メモ", icon: "mic" },
  { href: "/notebook", title: "実験ノート", icon: "notebook" },
  { href: "/literature", title: "論文検索", icon: "search" },
  { href: "/experiments", title: "実験一覧", icon: "file" },
];

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="font-serif text-2xl font-semibold text-ink">研究データ管理</h1>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {LINKS.map((item) => (
          <Link key={item.href} href={item.href} className="group">
            <Card className="card-hover h-full">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-md bg-accent-soft text-accent">
                  <Icon name={item.icon} className="h-5 w-5" />
                </span>
                <span className="text-[16px] font-medium text-ink group-hover:text-accent">
                  {item.title}
                </span>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
