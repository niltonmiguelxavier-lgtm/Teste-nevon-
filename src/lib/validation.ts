import { z } from "zod";

/** Esquemas de validação partilhados (validação sempre no servidor). */

export const phoneRegex = /^(\+?258)?[\s-]?8[2-7][\s-]?\d{3}[\s-]?\d{3,4}$/;

export const registerSchema = z.object({
  name: z.string().trim().min(3, "Indique o nome completo.").max(120),
  email: z.string().trim().toLowerCase().email("Email inválido."),
  phone: z
    .string()
    .trim()
    .min(9, "Indique um número de telefone válido.")
    .max(20)
    .regex(phoneRegex, "Use um número moçambicano válido (ex.: 84 123 4567)."),
  password: z
    .string()
    .min(8, "A palavra-passe deve ter pelo menos 8 caracteres.")
    .max(72, "A palavra-passe é demasiado longa.")
    .regex(/[A-Za-z]/, "Inclua pelo menos uma letra.")
    .regex(/\d/, "Inclua pelo menos um número."),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email inválido."),
  password: z.string().min(1, "Indique a palavra-passe."),
});

export const addressSchema = z.object({
  recipient: z.string().trim().min(3, "Indique o nome de quem recebe.").max(120),
  phone: z.string().trim().min(9).max(20).regex(phoneRegex, "Telefone inválido."),
  street: z.string().trim().min(3, "Indique a rua/avenida.").max(160),
  number: z.string().trim().max(20).optional().or(z.literal("")),
  neighbourhood: z.string().trim().max(120).optional().or(z.literal("")),
  city: z.string().trim().min(2, "Indique a cidade.").max(80),
  reference: z.string().trim().max(200).optional().or(z.literal("")),
});

export const cartLineSchema = z.object({
  productId: z.string().uuid("Produto inválido."),
  quantity: z.number().int().min(1, "Quantidade mínima: 1.").max(99, "Quantidade máxima: 99."),
});

export const createOrderSchema = z.object({
  items: z.array(cartLineSchema).min(1, "O carrinho está vazio.").max(50),
  delivery: addressSchema,
  notes: z.string().trim().max(500).optional().or(z.literal("")),
  promoCode: z.string().trim().max(40).optional().or(z.literal("")),
});

export const paymentCreateSchema = z.object({
  method: z.enum(["SANDBOX", "MPESA", "EMOLA"]),
});

export const orderStatusUpdateSchema = z.object({
  status: z.enum(["PREPARING", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"]),
  note: z.string().trim().max(300).optional(),
});

export const courierAssignSchema = z.object({
  courierId: z.string().uuid().nullable(),
});

export const courierStatusSchema = z.object({
  status: z.enum(["OUT_FOR_DELIVERY", "DELIVERED"]),
  note: z.string().trim().max(300).optional(),
});

export const productSchema = z.object({
  name: z.string().trim().min(2, "Nome demasiado curto.").max(120),
  categoryId: z.string().uuid().nullable(),
  description: z.string().trim().max(600).optional().or(z.literal("")),
  priceCents: z.number().int().min(0).max(100_000_000),
  stock: z.number().int().min(0).max(1_000_000),
  unit: z.string().trim().min(1).max(12),
  imageUrl: z.string().trim().url("URL de imagem inválida.").max(500).optional().or(z.literal("")),
  featured: z.boolean(),
  active: z.boolean(),
});

export const courierCreateSchema = z.object({
  name: z.string().trim().min(3).max(120),
  email: z.string().trim().toLowerCase().email("Email inválido."),
  phone: z.string().trim().min(9).max(20),
  password: z.string().min(8, "Mínimo 8 caracteres.").max(72),
});
