"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  productId: string;
  disabled?: boolean;
  label?: string;
  compact?: boolean;
};

export function AddToCart({ productId, disabled, label = "Adicionar", compact }: Props) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");

  async function add() {
    setState("loading");
    try {
      const response = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", productId, quantity: 1 }),
      });
      if (!response.ok) throw new Error("falha");
      setState("done");
      router.refresh();
      setTimeout(() => setState("idle"), 1400);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 2000);
    }
  }

  return (
    <button
      type="button"
      onClick={add}
      disabled={disabled || state === "loading"}
      className={`btn btn--green ${compact ? "btn--sm" : ""}`}
      aria-live="polite"
    >
      {state === "loading" ? (
        <>
          <span className="spinner" /> A adicionar
        </>
      ) : state === "done" ? (
        "Adicionado ✓"
      ) : state === "error" ? (
        "Tente novamente"
      ) : disabled ? (
        "Esgotado"
      ) : (
        label
      )}
    </button>
  );
}
