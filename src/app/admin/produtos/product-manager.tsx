"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatMoney } from "@/lib/format";

type Product = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  stock: number;
  unit: string;
  featured: boolean;
  active: boolean;
  category_id: string | null;
  category_name: string | null;
};

type Props = {
  initialProducts: Product[];
  categories: Array<{ id: string; name: string }>;
};

const EMPTY_FORM = {
  name: "",
  categoryId: "",
  description: "",
  price: "",
  stock: "0",
  unit: "un",
  imageUrl: "",
  featured: false,
  active: true,
};

export function ProductManager({ initialProducts, categories }: Props) {
  const router = useRouter();
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editing, setEditing] = useState<Product | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function startEdit(product: Product) {
    setEditing(product);
    setForm({
      name: product.name,
      categoryId: product.category_id ?? "",
      description: product.description ?? "",
      price: (product.price_cents / 100).toFixed(2),
      stock: String(product.stock),
      unit: product.unit,
      imageUrl: "",
      featured: product.featured,
      active: product.active,
    });
    setMessage(null);
    setError(null);
  }

  function reset() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);

    const priceCents = Math.round(Number(form.price.replace(",", ".")) * 100);
    if (!Number.isFinite(priceCents) || priceCents < 0) {
      setError("Preço inválido. Use o formato 1250.00");
      setBusy(false);
      return;
    }

    const payload = {
      ...(editing ? { id: editing.id } : {}),
      name: form.name,
      categoryId: form.categoryId || null,
      description: form.description,
      priceCents,
      stock: Number(form.stock) || 0,
      unit: form.unit || "un",
      imageUrl: form.imageUrl,
      featured: form.featured,
      active: form.active,
    };

    try {
      const response = await fetch("/api/admin/products", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await response.json();
      if (!response.ok) {
        setError(json?.error?.message ?? "Não foi possível guardar.");
        return;
      }
      setMessage(editing ? "Produto actualizado." : "Produto criado.");
      reset();
      router.refresh();
    } catch {
      setError("Falha de rede.");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(product: Product, field: "active" | "featured") {
    setBusy(true);
    try {
      await fetch("/api/admin/products", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: product.id, [field]: !product[field] }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form className="card" onSubmit={submit} noValidate style={{ marginBottom: 22 }}>
        <div className="row row--between" style={{ marginBottom: 12 }}>
          <strong style={{ fontSize: "0.95rem" }}>
            {editing ? `Editar: ${editing.name}` : "Novo produto"}
          </strong>
          {editing ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={reset}>
              Cancelar edição
            </button>
          ) : null}
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="p-name">Nome</label>
            <input
              id="p-name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="p-category">Categoria</label>
            <select
              id="p-category"
              value={form.categoryId}
              onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
            >
              <option value="">Sem categoria</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field-row field-row--3">
          <div className="field">
            <label htmlFor="p-desc">Descrição</label>
            <input
              id="p-desc"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              placeholder="Descrição curta para o catálogo"
            />
          </div>
          <div className="field">
            <label htmlFor="p-price">Preço (MT)</label>
            <input
              id="p-price"
              inputMode="decimal"
              value={form.price}
              onChange={(event) => setForm({ ...form, price: event.target.value })}
              placeholder="1250.00"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="p-unit">Unidade</label>
            <input
              id="p-unit"
              value={form.unit}
              onChange={(event) => setForm({ ...form, unit: event.target.value })}
              placeholder="un / kg / cx"
            />
          </div>
        </div>

        <div className="field-row field-row--3">
          <div className="field">
            <label htmlFor="p-image">Imagem (URL, opcional)</label>
            <input
              id="p-image"
              value={form.imageUrl}
              onChange={(event) => setForm({ ...form, imageUrl: event.target.value })}
              placeholder="https://…"
            />
          </div>
          <div className="field">
            <label htmlFor="p-stock">Stock</label>
            <input
              id="p-stock"
              inputMode="numeric"
              value={form.stock}
              onChange={(event) => setForm({ ...form, stock: event.target.value })}
            />
          </div>
          <div className="field">
            <label>Visibilidade</label>
            <div className="row" style={{ gap: 16, paddingTop: 8 }}>
              <label className="row" style={{ gap: 6 }}>
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(event) => setForm({ ...form, active: event.target.checked })}
                />
                <span className="small">Activo</span>
              </label>
              <label className="row" style={{ gap: 6 }}>
                <input
                  type="checkbox"
                  checked={form.featured}
                  onChange={(event) => setForm({ ...form, featured: event.target.checked })}
                />
                <span className="small">Destaque</span>
              </label>
            </div>
          </div>
        </div>

        {error ? (
          <div className="form-error" role="alert">
            {error}
          </div>
        ) : null}
        {message ? <div className="form-ok">{message}</div> : null}

        <button className="btn btn--green btn--sm" type="submit" disabled={busy}>
          {busy ? <span className="spinner" /> : null}
          {editing ? "Guardar alterações" : "Criar produto"}
        </button>
      </form>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Produto</th>
              <th>Categoria</th>
              <th className="right">Preço</th>
              <th className="right">Stock</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {initialProducts.map((product) => (
              <tr key={product.id}>
                <td>
                  <strong style={{ fontSize: "0.88rem" }}>{product.name}</strong>
                  <div className="small muted">{product.unit}</div>
                </td>
                <td>{product.category_name ?? "—"}</td>
                <td className="right">{formatMoney(product.price_cents)}</td>
                <td className="right">{product.stock}</td>
                <td>
                  <div className="row" style={{ gap: 6 }}>
                    <button
                      type="button"
                      className={`pill ${product.active ? "pill--green" : "pill--red"}`}
                      style={{ border: 0, cursor: "pointer" }}
                      onClick={() => toggle(product, "active")}
                      disabled={busy}
                    >
                      {product.active ? "activo" : "inactivo"}
                    </button>
                    <button
                      type="button"
                      className={`pill ${product.featured ? "pill--ink" : "pill--grey"}`}
                      style={{ border: 0, cursor: "pointer" }}
                      onClick={() => toggle(product, "featured")}
                      disabled={busy}
                    >
                      {product.featured ? "destaque" : "normal"}
                    </button>
                  </div>
                </td>
                <td className="right">
                  <button className="btn btn--ghost btn--sm" onClick={() => startEdit(product)}>
                    Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
