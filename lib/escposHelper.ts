/**
 * escposHelper.ts — ESC/POS Command & Binary Receipt Generator
 * 
 * Mendukung thermal printer standar 58mm (32 kolom) dan 80mm (48 kolom).
 * Menghasilkan Uint8Array byte sequence yang siap dikirim via:
 * - Web Bluetooth API (GATT Characteristic writeValue)
 * - Web Serial API / Raw Socket / TCP Network Printer
 */

import type { Order, Tenant } from "@/types";

export interface EscPosOptions {
  paperSize?: "58mm" | "80mm";
  payMethod?: string;
  cashReceived?: number | null;
}

// ─── ESC/POS Raw Byte Constants ───
const CMD = {
  INIT: [0x1b, 0x40], // ESC @ (Initialize)
  ALIGN_LEFT: [0x1b, 0x61, 0x00], // ESC a 0
  ALIGN_CENTER: [0x1b, 0x61, 0x01], // ESC a 1
  ALIGN_RIGHT: [0x1b, 0x61, 0x02], // ESC a 2
  BOLD_ON: [0x1b, 0x45, 0x01], // ESC E 1
  BOLD_OFF: [0x1b, 0x45, 0x00], // ESC E 0
  DOUBLE_SIZE_ON: [0x1d, 0x21, 0x11], // GS ! 0x11 (2x width & 2x height)
  DOUBLE_HEIGHT_ON: [0x1d, 0x21, 0x01], // GS ! 0x01 (2x height)
  DOUBLE_WIDTH_ON: [0x1d, 0x21, 0x10], // GS ! 0x10 (2x width)
  NORMAL_SIZE: [0x1d, 0x21, 0x00], // GS ! 0x00 (Normal)
  LINE_FEED: [0x0a], // LF
  FEED_3_LINES: [0x1b, 0x64, 0x03], // ESC d 3
  FEED_5_LINES: [0x1b, 0x64, 0x05], // ESC d 5
  CUT_PARTIAL: [0x1d, 0x56, 0x01], // GS V 1 (Partial Cut)
  CUT_FULL: [0x1d, 0x56, 0x00], // GS V 0 (Full Cut)
  BEEP: [0x1b, 0x42, 0x02, 0x02], // ESC B 2 2 (Beep 2x)
};

class EscPosBuilder {
  private buffer: number[] = [];
  private width: number;

  constructor(paperSize: "58mm" | "80mm" = "58mm") {
    this.width = paperSize === "80mm" ? 48 : 32;
    this.add(CMD.INIT);
  }

  add(bytes: number[]) {
    this.buffer.push(...bytes);
    return this;
  }

  text(str: string) {
    // Encode string to single-byte ASCII/CP437 characters
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      this.buffer.push(code > 255 ? 63 : code); // Replace non-ascii with '?'
    }
    return this;
  }

  newLine(count: number = 1) {
    for (let i = 0; i < count; i++) {
      this.buffer.push(0x0a);
    }
    return this;
  }

  line(str: string = "") {
    this.text(str);
    this.newLine();
    return this;
  }

  alignLeft() {
    return this.add(CMD.ALIGN_LEFT);
  }

  alignCenter() {
    return this.add(CMD.ALIGN_CENTER);
  }

  alignRight() {
    return this.add(CMD.ALIGN_RIGHT);
  }

  bold(enable: boolean = true) {
    return this.add(enable ? CMD.BOLD_ON : CMD.BOLD_OFF);
  }

  doubleSize(enable: boolean = true) {
    return this.add(enable ? CMD.DOUBLE_SIZE_ON : CMD.NORMAL_SIZE);
  }

  doubleHeight(enable: boolean = true) {
    return this.add(enable ? CMD.DOUBLE_HEIGHT_ON : CMD.NORMAL_SIZE);
  }

  divider(char: string = "-") {
    this.alignLeft();
    this.line(char.repeat(this.width));
    return this;
  }

  dottedDivider() {
    return this.divider("-");
  }

  /**
   * Print 2 kolom: kiri dan kanan rata samping
   * Contoh: "Subtotal              Rp 50.000"
   */
  twoCol(left: string, right: string) {
    this.alignLeft();
    const spaceCount = this.width - left.length - right.length;
    if (spaceCount < 1) {
      // Jika terlalu panjang, pisah baris
      this.line(left);
      this.alignRight().line(right).alignLeft();
    } else {
      this.line(left + " ".repeat(spaceCount) + right);
    }
    return this;
  }

  cut() {
    this.add(CMD.FEED_5_LINES);
    this.add(CMD.CUT_PARTIAL);
    return this;
  }

  build(): Uint8Array {
    return new Uint8Array(this.buffer);
  }
}

/**
 * Helper pembuat struk pesanan lengkap dalam format byte ESC/POS
 */
export function generateReceiptEscPos(
  order: Order,
  tenant: Tenant,
  options: EscPosOptions = {}
): Uint8Array {
  const rc = tenant.receipt_config;
  const paperSize = options.paperSize || (rc?.paper_size === "80mm" ? "80mm" : "58mm");
  const payMethod = options.payMethod || order.payment_method || "cash";
  const cashReceived = options.cashReceived;

  const builder = new EscPosBuilder(paperSize);

  // 1. Header Outlet
  builder.alignCenter().doubleHeight(true).bold(true);
  builder.line(tenant.name.toUpperCase());
  builder.doubleHeight(false).bold(false);

  if (rc?.header_text) {
    const headerLines = rc.header_text.split("\n");
    for (const hLine of headerLines) {
      if (hLine.trim()) builder.line(hLine.trim());
    }
  }

  if (rc?.show_wifi_info && rc?.wifi_name) {
    builder.line(`WiFi: ${rc.wifi_name}${rc.wifi_password ? ` (Pass: ${rc.wifi_password})` : ""}`);
  }

  builder.dottedDivider();

  // 2. Info Transaksi & Antrian
  builder.alignCenter().doubleSize(true).bold(true);
  builder.line(`ANTRIAN #${order.queue_number}`);
  builder.doubleSize(false).bold(false);

  const dateStr = new Date(order.created_at).toLocaleString("id-ID", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  builder.alignLeft();
  builder.twoCol("Waktu", dateStr);
  builder.twoCol("Tipe Pesanan", order.order_type === "takeaway" ? "TAKEAWAY" : "DINE-IN");

  if (order.table_number) {
    builder.twoCol("No. Meja", order.table_number);
  }

  // Nama pelanggan jika ada
  if (order.customer_name) {
    builder.twoCol("Pelanggan", order.customer_name);
  }

  builder.dottedDivider();

  // 3. Daftar Item
  if (order.items && order.items.length > 0) {
    for (const it of order.items) {
      builder.bold(true).line(it.product_name_snapshot).bold(false);

      // Varian
      if (it.selected_variants && it.selected_variants.length > 0) {
        for (const v of it.selected_variants) {
          const addPrice = v.additional_price > 0 ? ` (+Rp ${v.additional_price.toLocaleString("id-ID")})` : "";
          builder.line(`  ${v.group}: ${v.option}${addPrice}`);
        }
      }

      // Catatan per item
      if (it.notes) {
        builder.line(`  Catatan: ${it.notes}`);
      }

      // Qty x Harga = Subtotal
      const leftPart = `  ${it.quantity} x Rp ${it.unit_price.toLocaleString("id-ID")}`;
      const rightPart = `Rp ${(it.unit_price * it.quantity).toLocaleString("id-ID")}`;
      builder.twoCol(leftPart, rightPart);
    }
  }

  builder.dottedDivider();

  // 4. Perhitungan Finansial
  builder.twoCol("Subtotal", `Rp ${order.subtotal.toLocaleString("id-ID")}`);

  if (order.tax_amount > 0) {
    const taxPct = order.finance_snapshot?.tax_percentage ?? tenant.finance_config?.tax_percentage ?? 0;
    builder.twoCol(`PPN (${taxPct}%)`, `Rp ${order.tax_amount.toLocaleString("id-ID")}`);
  }

  if (order.service_charge_amount > 0) {
    const svcPct = order.finance_snapshot?.service_charge_percentage ?? tenant.finance_config?.service_charge_percentage ?? 0;
    builder.twoCol(`Service Charge (${svcPct}%)`, `Rp ${order.service_charge_amount.toLocaleString("id-ID")}`);
  }

  if (order.takeaway_fee_amount > 0) {
    builder.twoCol("Biaya Takeaway", `Rp ${order.takeaway_fee_amount.toLocaleString("id-ID")}`);
  }

  builder.divider("=");
  builder.bold(true).doubleHeight(true);
  builder.twoCol("TOTAL", `Rp ${order.total_amount.toLocaleString("id-ID")}`);
  builder.doubleHeight(false).bold(false);
  builder.divider("=");

  // 5. Informasi Pembayaran
  let payLabel = "TUNAI";
  if (payMethod === "qris_static" || payMethod === "gateway") payLabel = "QRIS / DIGITAL";
  else if (payMethod === "bank_transfer") payLabel = "TRANSFER BANK";

  builder.twoCol("Metode Bayar", payLabel);

  if (payMethod === "cash" && cashReceived !== null && cashReceived !== undefined) {
    builder.twoCol("Tunai Diterima", `Rp ${cashReceived.toLocaleString("id-ID")}`);
    const change = Math.max(0, cashReceived - order.total_amount);
    builder.bold(true).twoCol("Kembalian", `Rp ${change.toLocaleString("id-ID")}`).bold(false);
  }

  builder.twoCol("Status", "LUNAS [PAID]");
  builder.dottedDivider();

  // 6. Footer Struk
  builder.alignCenter();
  if (rc?.footer_text) {
    const footerLines = rc.footer_text.split("\n");
    for (const fLine of footerLines) {
      if (fLine.trim()) builder.line(fLine.trim());
    }
  } else {
    builder.line("Terima kasih atas kunjungan Anda!");
  }

  builder.line("-- Pesanin App --");

  // 7. Cut Paper
  builder.cut();

  return builder.build();
}
