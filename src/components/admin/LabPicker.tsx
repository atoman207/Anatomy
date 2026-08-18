"use client";

import { useRouter } from "next/navigation";
import { Field, Select } from "@/components/ui";

/** Switches which laboratory an admin page is showing, via the URL. */
export function LabPicker({
  labs, current, basePath,
}: {
  labs: { id: string; name: string }[];
  current: string;
  basePath: string;
}) {
  const router = useRouter();
  return (
    <div className="max-w-sm">
      <Field label="研究室">
        <Select
          value={current}
          onChange={(e) => router.push(`${basePath}?lab=${encodeURIComponent(e.target.value)}`)}
        >
          {labs.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
