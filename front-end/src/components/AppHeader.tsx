import { Sparkles, Link2, BarChart3 } from "lucide-react";
import { NavLink } from "react-router-dom";
import clsx from "clsx";

const navItems = [
  { to: "/", label: "Social Agent", icon: Sparkles },
  { to: "/strategist", label: "Strategist Inlinks", icon: Link2 },
  { to: "/trends-master", label: "Trends Master", icon: BarChart3 },
];

/** Header compartilhado com navegação entre as páginas do app. */
export function AppHeader() {
  return (
    <header className="bg-white border-b border-gray-100 px-6 py-3 flex items-center justify-between sticky top-0 z-10 shadow-sm">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2 text-primary">
          <Sparkles className="w-6 h-6" />
          <h1 className="text-xl font-semibold tracking-tight text-gray-900">
            SocialAgent
          </h1>
        </div>

        <nav className="hidden md:flex items-center gap-1 ml-4">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-orange-50 text-primary"
                    : "text-gray-500 hover:text-gray-700 hover:bg-gray-50",
                )
              }
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  );
}
