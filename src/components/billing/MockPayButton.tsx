"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { useToast } from "@/components/shell/Toast";
import { formatJpy } from "@/lib/billing/plans";
import { completeMockCheckout } from "@/lib/billing/actions";

export function MockPayButton({
  labId, plan, amountJpy,
}: {
  labId: string;
  plan: string;
  amountJpy: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [paying, setPaying] = useState(false);

  async function pay() {
    setPaying(true);
    try {
      const res = await completeMockCheckout(labId, plan);
      if (!res.ok) {
        toast(res.error ?? "支払いを完了できませんでした。", { tone: "danger" });
        setPaying(false);
        return;
      }
      router.push(`/billing?checkout=success&lab=${labId}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "支払いを完了できませんでした。", { tone: "danger" });
      setPaying(false);
    }
  }

  return (
    <Button variant="primary" className="w-full" disabled={paying} onClick={pay}>
      {paying ? "処理中…" : `${formatJpy(amountJpy)} を支払う`}
    </Button>
  );
}
