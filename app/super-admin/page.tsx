"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Table, Button, Modal, Form, Input, Select, Switch, Tag,
  Tooltip, message, Divider, Card, Statistic, Row, Col,
  Space, Badge, Steps, Popconfirm, Drawer, InputNumber,
  Upload, Empty,
} from "antd";
import {
  PlusOutlined, EditOutlined, LinkOutlined, LogoutOutlined,
  ShopOutlined, DeleteOutlined, BookOutlined, ArrowLeftOutlined,
  ArrowRightOutlined, CheckOutlined, UserOutlined, SettingOutlined,
  AppstoreOutlined,
} from "@ant-design/icons";
import { motion, AnimatePresence } from "framer-motion";
import { createTenant, updateTenant } from "@/services/tenantService";
import { signOut, getCurrentProfile } from "@/services/authService";
import { useRouter } from "next/navigation";
import type { Tenant, Category, Product, BusinessLogic, FinanceConfig, ReceiptConfig, ManualPaymentChannel } from "@/types";

const STEPS = ["Identitas & Branding", "Konfigurasi Bisnis", "Akun Owner", "Review & Selesai"];

type WizardData = {
  name: string; slug: string; subtitle: string; description: string; logo_url: string;
  primary_color: string; secondary_color: string;
  payment_timing: "prepaid" | "postpaid"; payment_mode: "gateway" | "manual";
  numbering: "queue" | "table"; require_cashier_verification: boolean;
  tax_percentage: number; service_charge_percentage: number; takeaway_fee: number;
  receipt_header: string; receipt_footer: string;
  owner_name: string; owner_email: string; owner_password: string;
};

const DEFAULT_WIZARD: WizardData = {
  name: "", slug: "", subtitle: "", description: "", logo_url: "",
  primary_color: "#6366f1", secondary_color: "#a5b4fc",
  payment_timing: "prepaid", payment_mode: "manual",
  numbering: "queue", require_cashier_verification: false,
  tax_percentage: 11, service_charge_percentage: 5, takeaway_fee: 2000,
  receipt_header: "", receipt_footer: "Terima kasih atas kunjungan Anda!",
  owner_name: "", owner_email: "", owner_password: "",
};

export default function SuperAdminPage() {
  const router = useRouter();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardData, setWizardData] = useState<WizardData>(DEFAULT_WIZARD);
  const [saving, setSaving] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);

  const [menuDrawer, setMenuDrawer] = useState<{ open: boolean; tenant: Tenant | null }>({ open: false, tenant: null });
  const [menuData, setMenuData] = useState<{ categories: Category[]; products: Product[] }>({ categories: [], products: [] });
  const [menuLoading, setMenuLoading] = useState(false);
  const [menuTab, setMenuTab] = useState<"categories" | "products">("categories");
  const [catForm] = Form.useForm();
  const [prodForm] = Form.useForm();
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [prodModalOpen, setProdModalOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<Category | null>(null);
  const [editingProd, setEditingProd] = useState<Product | null>(null);

  useEffect(() => {
    if (catModalOpen) {
      if (editingCat) {
        catForm.setFieldsValue({ name: editingCat.name, sort_order: editingCat.sort_order, is_active: editingCat.is_active });
      } else {
        catForm.resetFields();
      }
    }
  }, [catModalOpen, editingCat, catForm]);

  useEffect(() => {
    if (prodModalOpen) {
      if (editingProd) {
        prodForm.setFieldsValue({
          name: editingProd.name, description: editingProd.description,
          base_price: editingProd.base_price, image_url: editingProd.image_urls[0] ?? "",
          category_id: editingProd.category_id, is_available: editingProd.is_available,
          is_featured: editingProd.is_featured, stock_count: editingProd.stock_count,
          sort_order: editingProd.sort_order, labels: editingProd.labels.join(", "),
        });
      } else {
        prodForm.resetFields();
        prodForm.setFieldsValue({ is_available: true, is_featured: false });
      }
    }
  }, [prodModalOpen, editingProd, prodForm]);

  const [step1Form] = Form.useForm();
  const [step2Form] = Form.useForm();
  const [step3Form] = Form.useForm();

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/tenants");
    const data = await res.json();
    setTenants(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    getCurrentProfile().then((p) => { if (!p || p.role !== "SUPER_ADMIN") router.replace("/login"); });
    refresh();
  }, [refresh, router]);

  const openAdd = () => {
    setEditingTenant(null);
    setWizardData(DEFAULT_WIZARD);
    setWizardStep(0);
    step1Form.resetFields();
    step2Form.resetFields();
    step3Form.resetFields();
    step1Form.setFieldsValue({ primary_color: "#6366f1", secondary_color: "#a5b4fc" });
    step2Form.setFieldsValue({ payment_timing: "prepaid", payment_mode: "manual", numbering: "queue", require_cashier_verification: false, tax_percentage: 11, service_charge_percentage: 5, takeaway_fee: 2000, receipt_footer: "Terima kasih atas kunjungan Anda!" });
    setWizardOpen(true);
  };

  const openEdit = (t: Tenant) => {
    setEditingTenant(t);
    setWizardData({
      ...DEFAULT_WIZARD,
      name: t.name, slug: t.slug, subtitle: t.subtitle ?? "", description: t.description ?? "",
      logo_url: t.logo_url ?? "",
      primary_color: t.visual_config.primary_color, secondary_color: t.visual_config.secondary_color,
      payment_timing: t.business_logic.payment_timing, payment_mode: t.business_logic.payment_mode,
      numbering: t.business_logic.numbering, require_cashier_verification: t.business_logic.require_cashier_verification,
      tax_percentage: t.finance_config.tax_percentage, service_charge_percentage: t.finance_config.service_charge_percentage,
      takeaway_fee: t.finance_config.takeaway_fee,
      receipt_header: t.receipt_config.header_text, receipt_footer: t.receipt_config.footer_text,
    });
    step1Form.setFieldsValue({ name: t.name, slug: t.slug, subtitle: t.subtitle, description: t.description, logo_url: t.logo_url, primary_color: t.visual_config.primary_color, secondary_color: t.visual_config.secondary_color });
    step2Form.setFieldsValue({ payment_timing: t.business_logic.payment_timing, payment_mode: t.business_logic.payment_mode, numbering: t.business_logic.numbering, require_cashier_verification: t.business_logic.require_cashier_verification, tax_percentage: t.finance_config.tax_percentage, service_charge_percentage: t.finance_config.service_charge_percentage, takeaway_fee: t.finance_config.takeaway_fee, receipt_header: t.receipt_config.header_text, receipt_footer: t.receipt_config.footer_text });
    setWizardStep(0);
    setWizardOpen(true);
  };

  const mergeStep = (vals: Partial<WizardData>) => setWizardData((p) => ({ ...p, ...vals }));

  const nextStep = async () => {
    if (wizardStep === 0) {
      try { const v = await step1Form.validateFields(); mergeStep(v); setWizardStep(1); } catch {}
    } else if (wizardStep === 1) {
      try { const v = await step2Form.validateFields(); mergeStep(v); setWizardStep(editingTenant ? 3 : 2); } catch {}
    } else if (wizardStep === 2) {
      try { const v = await step3Form.validateFields(); mergeStep(v); setWizardStep(3); } catch {}
    }
  };

  const prevStep = () => {
    if (wizardStep === 3 && !editingTenant) setWizardStep(2);
    else if (wizardStep === 2) setWizardStep(1);
    else setWizardStep((s) => Math.max(0, s - 1));
  };

  const buildPayload = (d: WizardData) => ({
    name: d.name, slug: d.slug.toLowerCase().replace(/\s+/g, "-"),
    subtitle: d.subtitle || null, description: d.description || null, logo_url: d.logo_url || null,
    is_active: true,
    visual_config: { primary_color: d.primary_color, secondary_color: d.secondary_color },
    business_logic: { payment_timing: d.payment_timing, payment_mode: d.payment_mode, numbering: d.numbering, require_cashier_verification: d.require_cashier_verification } as BusinessLogic,
    finance_config: { tax_percentage: d.tax_percentage ?? 0, service_charge_percentage: d.service_charge_percentage ?? 0, takeaway_fee: d.takeaway_fee ?? 0 } as FinanceConfig,
    manual_payment_channels: d.payment_mode === "manual" ? [
      { id: "ch-001", type: "qris_static", label: "QRIS / E-Wallet", instructions: "Scan QR lalu tunjukkan bukti ke kasir" },
      { id: "ch-002", type: "cash", label: "Tunai / Cash", instructions: "Bayar langsung ke kasir" },
    ] as ManualPaymentChannel[] : [],
    receipt_config: { header_text: d.receipt_header || "", footer_text: d.receipt_footer || "", show_logo: true } as ReceiptConfig,
    payment_gateway_config: {},
  });

  const handleSubmit = async () => {
    setSaving(true);
    const d = wizardData;
    if (editingTenant) {
      const ok = await updateTenant(editingTenant.id, buildPayload(d));
      if (ok) { message.success("Tenant diupdate"); setWizardOpen(false); refresh(); }
      else message.error("Gagal update");
    } else {
      const res = await fetch("/api/admin/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...buildPayload(d), ownerEmail: d.owner_email, ownerPassword: d.owner_password, ownerName: d.owner_name }),
      });
      const result = await res.json();
      if (res.ok || res.status === 207) {
        message.success(`Tenant "${result.name}" berhasil dibuat!`);
        if (res.status === 207) message.warning("Tenant dibuat tapi ada masalah membuat akun owner.");
        setWizardOpen(false); refresh();
      } else {
        message.error(result.error ?? "Gagal membuat tenant");
      }
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/admin/tenants/${id}`, { method: "DELETE" });
    if (res.ok) { message.success("Tenant dihapus"); refresh(); }
    else message.error("Gagal menghapus tenant");
  };

  const toggleActive = async (t: Tenant) => {
    await fetch(`/api/admin/tenants/${t.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: !t.is_active }) });
    refresh();
  };

  const openMenu = async (t: Tenant) => {
    setMenuDrawer({ open: true, tenant: t });
    setMenuLoading(true);
    const res = await fetch(`/api/admin/tenants/${t.id}/menu`);
    const data = await res.json();
    setMenuData(data);
    setMenuLoading(false);
  };

  const refreshMenu = async () => {
    if (!menuDrawer.tenant) return;
    const res = await fetch(`/api/admin/tenants/${menuDrawer.tenant.id}/menu`);
    setMenuData(await res.json());
  };

  const saveCat = async (vals: { name: string; sort_order: number }) => {
    if (!menuDrawer.tenant) return;
    if (editingCat) {
      await fetch(`/api/admin/tenants/${menuDrawer.tenant.id}/menu`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ _type: "category", _itemId: editingCat.id, ...vals }) });
    } else {
      await fetch(`/api/admin/tenants/${menuDrawer.tenant.id}/menu`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ _type: "category", ...vals }) });
    }
    catForm.resetFields(); setCatModalOpen(false); setEditingCat(null); refreshMenu();
  };

  const deleteCat = async (id: string) => {
    if (!menuDrawer.tenant) return;
    await fetch(`/api/admin/tenants/${menuDrawer.tenant.id}/menu`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ _type: "category", _itemId: id }) });
    refreshMenu();
  };

  const saveProd = async (vals: Record<string, unknown>) => {
    if (!menuDrawer.tenant) return;
    const { image_url, labels: labelsRaw, ...rest } = vals;
    const payload = {
      ...rest,
      image_urls: image_url ? [image_url] : [],
      labels: ((labelsRaw as string) ?? "").split(",").map((s: string) => s.trim()).filter(Boolean),
    };
    if (editingProd) {
      await fetch(`/api/admin/tenants/${menuDrawer.tenant.id}/menu`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ _type: "product", _itemId: editingProd.id, ...payload }) });
    } else {
      await fetch(`/api/admin/tenants/${menuDrawer.tenant.id}/menu`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ _type: "product", ...payload }) });
    }
    prodForm.resetFields(); setProdModalOpen(false); setEditingProd(null); refreshMenu();
  };

  const deleteProd = async (id: string) => {
    if (!menuDrawer.tenant) return;
    await fetch(`/api/admin/tenants/${menuDrawer.tenant.id}/menu`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ _type: "product", _itemId: id }) });
    refreshMenu();
  };

  const handleLogout = async () => { await signOut(); router.push("/login"); };

  const activeTenants = tenants.filter((t) => t.is_active).length;

  const columns = [
    {
      title: "Tenant",
      render: (_: unknown, t: Tenant) => (
        <Space orientation="vertical" size={2}>
          <Space>
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: t.visual_config.primary_color, display: "inline-block", flexShrink: 0 }} />
            <span className="font-semibold">{t.name}</span>
            <Tag color="blue" style={{ fontSize: 11 }}>/{t.slug}</Tag>
          </Space>
          {t.subtitle && <span style={{ color: "#94a3b8", fontSize: 12 }}>{t.subtitle}</span>}
        </Space>
      ),
    },
    {
      title: "Konfigurasi",
      render: (_: unknown, t: Tenant) => (
        <Space size={4} wrap>
          <Tag>{t.business_logic.payment_timing === "prepaid" ? "Bayar Dulu" : "Pay Later"}</Tag>
          <Tag>{t.business_logic.payment_mode === "gateway" ? "Gateway" : "Manual"}</Tag>
          <Tag>{t.business_logic.numbering === "queue" ? "Antrian" : "Meja"}</Tag>
          {t.business_logic.require_cashier_verification && <Tag color="orange">Verif. Kasir</Tag>}
        </Space>
      ),
    },
    {
      title: "Status",
      render: (_: unknown, t: Tenant) => (
        <Switch checked={t.is_active} onChange={() => toggleActive(t)} checkedChildren="Aktif" unCheckedChildren="Off" />
      ),
    },
    {
      title: "Aksi",
      render: (_: unknown, t: Tenant) => (
        <Space wrap size={4}>
          <Tooltip title="Edit Tenant"><Button icon={<EditOutlined />} size="small" onClick={() => openEdit(t)} /></Tooltip>
          <Tooltip title="Kelola Menu"><Button icon={<BookOutlined />} size="small" onClick={() => openMenu(t)}>Menu</Button></Tooltip>
          <Tooltip title="Buka Kiosk"><Button size="small" onClick={() => window.open(`/${t.slug}/kiosk`, "_blank")}>Kiosk</Button></Tooltip>
          <Tooltip title="Buka Kasir"><Button size="small" onClick={() => window.open(`/${t.slug}/cashier`, "_blank")}>Kasir</Button></Tooltip>
          <Tooltip title="Buka Dapur"><Button size="small" onClick={() => window.open(`/${t.slug}/kitchen`, "_blank")}>Dapur</Button></Tooltip>
          <Popconfirm
            title="Hapus tenant ini?"
            description="Semua data (menu, pesanan, akun staff) akan ikut terhapus permanen."
            onConfirm={() => handleDelete(t.id)}
            okText="Ya, Hapus"
            okButtonProps={{ danger: true }}
            cancelText="Batal"
          >
            <Button icon={<DeleteOutlined />} size="small" danger />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const stepContent = [
    /* Step 0 — Identitas */
    <Form key="s1" form={step1Form} layout="vertical" requiredMark="optional">
      <Row gutter={12}>
        <Col span={14}>
          <Form.Item name="name" label="Nama Kafe / Restoran" rules={[{ required: true, message: "Wajib diisi" }]}>
            <Input prefix={<ShopOutlined />} placeholder="Kafe Asik" size="large"
              onChange={(e) => { if (!editingTenant) step1Form.setFieldValue("slug", e.target.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")); }} />
          </Form.Item>
        </Col>
        <Col span={10}>
          <Form.Item name="slug" label="Slug URL" rules={[{ required: true }, { pattern: /^[a-z0-9-]+$/, message: "Hanya a-z, 0-9, tanda hubung" }]} extra={<span style={{ fontSize: 11 }}>domain.com/<b>slug</b>/kiosk</span>}>
            <Input placeholder="kafe-asik" size="large"
              onChange={(e) => {
                const clean = e.target.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
                step1Form.setFieldValue("slug", clean);
              }}
            />
          </Form.Item>
        </Col>
      </Row>
      <Form.Item name="subtitle" label="Tagline">
        <Input placeholder="Tempat nongkrong paling asik" />
      </Form.Item>
      <Form.Item name="description" label="Deskripsi Singkat">
        <Input.TextArea rows={2} placeholder="Kafe modern dengan suasana nyaman..." />
      </Form.Item>
      <Form.Item name="logo_url" label="URL Logo">
        <Input placeholder="https://..." prefix="🖼️" />
      </Form.Item>
      <Divider style={{ margin: "12px 0", fontSize: 13 }}>Warna Tema</Divider>
      <Row gutter={12}>
        <Col span={12}>
          <Form.Item name="primary_color" label="Warna Utama">
            <Input type="color" style={{ width: "100%", height: 40, cursor: "pointer" }} />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="secondary_color" label="Warna Sekunder">
            <Input type="color" style={{ width: "100%", height: 40, cursor: "pointer" }} />
          </Form.Item>
        </Col>
      </Row>
    </Form>,

    /* Step 1 — Bisnis */
    <Form key="s2" form={step2Form} layout="vertical" requiredMark="optional">
      <Divider style={{ margin: "0 0 16px", fontSize: 13 }}>Alur Pembayaran</Divider>
      <Row gutter={12}>
        <Col span={12}>
          <Form.Item name="payment_timing" label="Waktu Bayar" rules={[{ required: true }]}>
            <Select size="large">
              <Select.Option value="prepaid">💳 Bayar di Depan (Prepaid)</Select.Option>
              <Select.Option value="postpaid">🍽️ Bayar Setelah Makan (Postpaid)</Select.Option>
            </Select>
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="payment_mode" label="Mode Pembayaran" rules={[{ required: true }]}>
            <Select size="large">
              <Select.Option value="manual">📱 Manual (QRIS / Transfer / Cash)</Select.Option>
              <Select.Option value="gateway">🌐 Gateway (Midtrans / Xendit)</Select.Option>
            </Select>
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={12}>
        <Col span={12}>
          <Form.Item name="numbering" label="Sistem Penomoran" rules={[{ required: true }]}>
            <Select size="large">
              <Select.Option value="queue">🔢 Nomor Antrian</Select.Option>
              <Select.Option value="table">🪑 Nomor Meja</Select.Option>
            </Select>
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="require_cashier_verification" label="Verifikasi Kasir" valuePropName="checked" extra="Kasir approve sebelum masuk dapur (cocok untuk postpaid)">
            <Switch checkedChildren="Aktif" unCheckedChildren="Nonaktif" />
          </Form.Item>
        </Col>
      </Row>
      <Divider style={{ margin: "12px 0", fontSize: 13 }}>Keuangan</Divider>
      <Row gutter={12}>
        <Col span={8}><Form.Item name="tax_percentage" label="PPN (%)"><InputNumber min={0} max={100} style={{ width: "100%" }} /></Form.Item></Col>
        <Col span={8}><Form.Item name="service_charge_percentage" label="Service Charge (%)"><InputNumber min={0} max={100} style={{ width: "100%" }} /></Form.Item></Col>
        <Col span={8}><Form.Item name="takeaway_fee" label="Biaya Takeaway (Rp)"><InputNumber min={0}
          formatter={(v) => Number(v || 0).toLocaleString("id-ID")}
          parser={(v) => Number((v ?? "").replace(/[^\d]/g, "")) as unknown as 0}
          style={{ width: "100%" }} /></Form.Item></Col>
      </Row>
      <Divider style={{ margin: "12px 0", fontSize: 13 }}>Struk / Receipt</Divider>
      <Form.Item name="receipt_header" label="Header Struk"><Input.TextArea rows={2} placeholder={"Nama Kafe\nAlamat Lengkap\nNo. Telp"} /></Form.Item>
      <Form.Item name="receipt_footer" label="Footer Struk"><Input placeholder="Terima kasih atas kunjungan Anda!" /></Form.Item>
    </Form>,

    /* Step 2 — Owner */
    <Form key="s3" form={step3Form} layout="vertical" requiredMark="optional">
      <div style={{ background: "#f0f4ff", border: "1px solid #c7d2fe", borderRadius: 10, padding: "12px 16px", marginBottom: 20 }}>
        <p style={{ margin: 0, color: "#3730a3", fontSize: 13 }}>
          <b>💡 Opsional:</b> Buat akun owner untuk tenant ini sekarang. Owner dapat login dan mengakses layar Kasir & pengaturan tenant. Bisa diisi nanti.
        </p>
      </div>
      <Form.Item name="owner_name" label="Nama Owner">
        <Input prefix={<UserOutlined />} placeholder="John Doe" size="large" />
      </Form.Item>
      <Form.Item name="owner_email" label="Email Owner" rules={[{ type: "email", message: "Format email tidak valid" }]}>
        <Input prefix="📧" placeholder="owner@kafeasik.com" size="large" />
      </Form.Item>
      <Form.Item name="owner_password" label="Password" extra="Min. 8 karakter" rules={[{ min: 8, message: "Minimal 8 karakter" }]}>
        <Input.Password placeholder="••••••••" size="large" />
      </Form.Item>
    </Form>,

    /* Step 3 — Review */
    <div key="s4">
      <div style={{ background: "#f8fafc", borderRadius: 12, padding: 20, border: "1px solid #e2e8f0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: wizardData.primary_color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>🏪</div>
          <div>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 18 }}>{wizardData.name || "—"}</p>
            <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>/{wizardData.slug || "—"}</p>
          </div>
        </div>

        <Row gutter={[16, 8]}>
          <Col span={12}><ReviewItem label="Tagline" value={wizardData.subtitle} /></Col>
          <Col span={12}><ReviewItem label="Warna Utama" value={<span style={{ display: "flex", gap: 6, alignItems: "center" }}><span style={{ width: 14, height: 14, borderRadius: 4, background: wizardData.primary_color, display: "inline-block" }} />{wizardData.primary_color}</span>} /></Col>
          <Col span={12}><ReviewItem label="Waktu Bayar" value={wizardData.payment_timing === "prepaid" ? "Bayar di Depan" : "Pay Later"} /></Col>
          <Col span={12}><ReviewItem label="Mode" value={wizardData.payment_mode === "manual" ? "Manual" : "Gateway"} /></Col>
          <Col span={12}><ReviewItem label="Penomoran" value={wizardData.numbering === "queue" ? "Antrian" : "Meja"} /></Col>
          <Col span={12}><ReviewItem label="PPN" value={`${wizardData.tax_percentage}%`} /></Col>
          <Col span={12}><ReviewItem label="Service Charge" value={`${wizardData.service_charge_percentage}%`} /></Col>
          <Col span={12}><ReviewItem label="Takeaway Fee" value={`Rp ${(wizardData.takeaway_fee ?? 0).toLocaleString("id-ID")}`} /></Col>
        </Row>

        {!editingTenant && (
          <>
            <Divider style={{ margin: "12px 0" }} />
            <p style={{ margin: "0 0 8px", fontWeight: 600 }}>👤 Akun Owner</p>
            {wizardData.owner_email
              ? <ReviewItem label="Email" value={wizardData.owner_email} />
              : <p style={{ color: "#94a3b8", fontSize: 13, margin: 0 }}>Tanpa akun owner (bisa dibuat nanti)</p>}
          </>
        )}
      </div>
    </div>,
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9" }}>
      {/* Header */}
      <header style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)", padding: "0 24px", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 2px 12px rgba(99,102,241,.3)" }}>
        <Space>
          <span style={{ color: "#fff", fontWeight: 900, fontSize: 22 }}>Pesanin</span>
          <span style={{ background: "rgba(255,255,255,.2)", color: "#fff", fontSize: 11, fontWeight: 600, padding: "2px 10px", borderRadius: 9999 }}>SUPER ADMIN</span>
        </Space>
        <Button type="text" icon={<LogoutOutlined />} style={{ color: "#fff" }} onClick={handleLogout}>Keluar</Button>
      </header>

      <div style={{ padding: 24, maxWidth: 1280, margin: "0 auto" }}>
        {/* Stats */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <Row gutter={16} style={{ marginBottom: 24 }}>
            {[
              { title: "Total Tenant", value: tenants.length, color: "#6366f1", icon: "🏪" },
              { title: "Aktif", value: activeTenants, color: "#22c55e", icon: "✅" },
              { title: "Nonaktif", value: tenants.length - activeTenants, color: "#ef4444", icon: "⛔" },
            ].map((s) => (
              <Col xs={24} sm={8} key={s.title}>
                <Card style={{ borderRadius: 14, border: "none", boxShadow: "0 2px 8px rgba(0,0,0,.06)" }}>
                  <Statistic title={<span style={{ color: "#64748b" }}>{s.title}</span>} value={s.value}
                    prefix={<span style={{ fontSize: 18, marginRight: 4 }}>{s.icon}</span>} styles={{ content: {color: s.color, fontWeight: 700} }} />
                </Card>
              </Col>
            ))}
          </Row>
        </motion.div>

        {/* Table */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card
            style={{ borderRadius: 16, border: "none", boxShadow: "0 2px 8px rgba(0,0,0,.06)" }}
            title={<Space><ShopOutlined /><span className="font-semibold">Daftar Tenant</span></Space>}
            extra={
              <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}
                style={{ background: "#6366f1", borderColor: "#6366f1", borderRadius: 8 }}>
                Tambah Tenant
              </Button>
            }
          >
            <Table dataSource={tenants} columns={columns} rowKey="id" loading={loading}
              pagination={{ pageSize: 10, showSizeChanger: false }}
              locale={{ emptyText: <Empty description="Belum ada tenant" /> }}
            />
          </Card>
        </motion.div>
      </div>

      {/* Wizard Modal */}
      <Modal
        title={
          <Space>
            {editingTenant ? <EditOutlined /> : <PlusOutlined />}
            <span>{editingTenant ? `Edit: ${editingTenant.name}` : "Tambah Tenant Baru"}</span>
          </Space>
        }
        open={wizardOpen}
        onCancel={() => setWizardOpen(false)}
        footer={null}
        width={640}
        destroyOnHidden
      >
        {/* Steps indicator */}
        <Steps
          current={wizardStep}
          size="small"
          style={{ marginBottom: 24 }}
          items={
            editingTenant
              ? [{ title: "Identitas" }, { title: "Konfigurasi" }, { title: "Selesai" }]
              : STEPS.map((t) => ({ title: t }))
          }
        />

        {/* Step content */}
        <div style={{ minHeight: 300 }}>
          <AnimatePresence mode="wait">
            <motion.div key={wizardStep} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.18 }}>
              {stepContent[editingTenant && wizardStep === 3 ? 3 : wizardStep === 3 && !editingTenant ? 3 : wizardStep]}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer buttons */}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 24, paddingTop: 16, borderTop: "1px solid #e2e8f0" }}>
          <Button onClick={wizardStep === 0 ? () => setWizardOpen(false) : prevStep} icon={wizardStep === 0 ? undefined : <ArrowLeftOutlined />}>
            {wizardStep === 0 ? "Batal" : "Kembali"}
          </Button>
          <Space>
            {wizardStep === 2 && !editingTenant && (
              <Button onClick={() => { setWizardStep(3); }} style={{ color: "#64748b" }}>
                Lewati (buat owner nanti)
              </Button>
            )}
            {wizardStep < (editingTenant ? 1 : 2) && (
              <Button type="primary" onClick={nextStep} icon={<ArrowRightOutlined />} iconPosition="end"
                style={{ background: "#6366f1", borderColor: "#6366f1" }}>
                Lanjut
              </Button>
            )}
            {((wizardStep === 2 && !editingTenant) || (wizardStep === 1 && editingTenant)) && (
              <Button type="primary" onClick={nextStep} icon={<ArrowRightOutlined />} iconPosition="end"
                style={{ background: "#6366f1", borderColor: "#6366f1" }}>
                {editingTenant ? "Review" : "Lanjut"}
              </Button>
            )}
            {wizardStep === 3 && (
              <Button type="primary" loading={saving} icon={<CheckOutlined />} onClick={handleSubmit}
                style={{ background: "#22c55e", borderColor: "#22c55e" }}>
                {editingTenant ? "Simpan Perubahan" : "Buat Tenant"}
              </Button>
            )}
          </Space>
        </div>
      </Modal>

      {/* Menu Drawer */}
      <Drawer
        title={
          <Space>
            <BookOutlined style={{ color: "#6366f1" }} />
            <span>Kelola Menu — {menuDrawer.tenant?.name}</span>
          </Space>
        }
        placement="right"
        size="large"
        open={menuDrawer.open}
        onClose={() => setMenuDrawer({ open: false, tenant: null })}
        extra={
          <Space>
            <Button type={menuTab === "categories" ? "primary" : "default"} size="small" icon={<AppstoreOutlined />}
              onClick={() => setMenuTab("categories")} style={menuTab === "categories" ? { background: "#6366f1", borderColor: "#6366f1" } : {}}>
              Kategori ({menuData.categories.length})
            </Button>
            <Button type={menuTab === "products" ? "primary" : "default"} size="small" icon={<BookOutlined />}
              onClick={() => setMenuTab("products")} style={menuTab === "products" ? { background: "#6366f1", borderColor: "#6366f1" } : {}}>
              Produk ({menuData.products.length})
            </Button>
          </Space>
        }
      >
        <AnimatePresence mode="wait">
          {menuTab === "categories" ? (
            <motion.div key="cats" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingCat(null); catForm.resetFields(); setCatModalOpen(true); }} style={{ background: "#6366f1", borderColor: "#6366f1" }}>
                  Tambah Kategori
                </Button>
              </div>
              <Table
                dataSource={menuData.categories}
                rowKey="id"
                loading={menuLoading}
                pagination={false}
                columns={[
                  { title: "Nama", dataIndex: "name" },
                  { title: "Urutan", dataIndex: "sort_order", width: 80 },
                  { title: "Status", render: (_: unknown, r: Category) => <Tag color={r.is_active ? "green" : "red"}>{r.is_active ? "Aktif" : "Nonaktif"}</Tag> },
                  {
                    title: "Aksi", width: 100, render: (_: unknown, r: Category) => (
                      <Space>
                      <Button size="small" icon={<EditOutlined />} onClick={() => {
                          setEditingCat(r);
                          setCatModalOpen(true); // form values diset via useEffect
                        }} />
                        <Popconfirm title="Hapus kategori ini?" onConfirm={() => deleteCat(r.id)} okText="Hapus" okButtonProps={{ danger: true }}>
                          <Button size="small" danger icon={<DeleteOutlined />} />
                        </Popconfirm>
                      </Space>
                    )
                  },
                ]}
              />
            </motion.div>
          ) : (
            <motion.div key="prods" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => {
                    setEditingProd(null);
                    setProdModalOpen(true); // reset via useEffect
                  }} style={{ background: "#6366f1", borderColor: "#6366f1" }}>
                  Tambah Produk
                </Button>
              </div>
              <Table
                dataSource={menuData.products}
                rowKey="id"
                loading={menuLoading}
                pagination={{ pageSize: 10 }}
                columns={[
                  { title: "Produk", render: (_: unknown, r: Product) => <Space orientation="vertical" size={0}><span className="font-medium">{r.name}</span><span style={{ color: "#94a3b8", fontSize: 12 }}>Rp {Number(r.base_price).toLocaleString("id-ID")}</span></Space> },
                  { title: "Kategori", render: (_: unknown, r: Product) => { const cat = menuData.categories.find(c => c.id === r.category_id); return cat?.name ?? <span style={{ color: "#94a3b8" }}>—</span>; } },
                  { title: "Label", render: (_: unknown, r: Product) => r.labels.map(l => <Tag key={l} style={{ fontSize: 11 }}>{l}</Tag>) },
                  { title: "Stok / Status", render: (_: unknown, r: Product) => <Space><Tag color={r.is_available ? "green" : "red"}>{r.is_available ? "Tersedia" : "Habis"}</Tag>{r.stock_count != null && <Tag>{r.stock_count}</Tag>}</Space> },
                  {
                    title: "Aksi", width: 90, render: (_: unknown, r: Product) => (
                      <Space>
                        <Button size="small" icon={<EditOutlined />} onClick={() => {
                            setEditingProd(r);
                            setProdModalOpen(true); // values diset via useEffect
                          }} />
                        <Popconfirm title="Hapus produk ini?" onConfirm={() => deleteProd(r.id)} okText="Hapus" okButtonProps={{ danger: true }}>
                          <Button size="small" danger icon={<DeleteOutlined />} />
                        </Popconfirm>
                      </Space>
                    )
                  },
                ]}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </Drawer>

      {/* Category Modal */}
      <Modal title={editingCat ? "Edit Kategori" : "Tambah Kategori"} open={catModalOpen}
        onCancel={() => { setCatModalOpen(false); setEditingCat(null); }}
        onOk={() => catForm.submit()} okText="Simpan">
        <Form form={catForm} onFinish={saveCat} layout="vertical">
          <Form.Item name="name" label="Nama Kategori" rules={[{ required: true }]}><Input placeholder="Kopi Panas" /></Form.Item>
          <Form.Item name="sort_order" label="Urutan Tampil"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="is_active" label="Aktif" valuePropName="checked"><Switch /></Form.Item>
        </Form>
      </Modal>

      {/* Product Modal */}
      <Modal title={editingProd ? "Edit Produk" : "Tambah Produk"} open={prodModalOpen}
        onCancel={() => { setProdModalOpen(false); setEditingProd(null); }}
        onOk={() => prodForm.submit()} okText="Simpan" width={560}>
        <Form form={prodForm} onFinish={saveProd} layout="vertical" requiredMark="optional">
          <Row gutter={12}>
            <Col span={16}><Form.Item name="name" label="Nama Produk" rules={[{ required: true }]}><Input placeholder="Espresso" /></Form.Item></Col>
            <Col span={8}><Form.Item name="base_price" label="Harga Dasar (Rp)" rules={[{ required: true }]}><InputNumber min={0}
              formatter={(v) => Number(v || 0).toLocaleString("id-ID")}
              parser={(v) => Number((v ?? "").replace(/[^\d]/g, "")) as unknown as 0}
              style={{ width: "100%" }} /></Form.Item></Col>
          </Row>
          <Form.Item name="description" label="Deskripsi"><Input.TextArea rows={2} /></Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="category_id" label="Kategori">
                <Select placeholder="Pilih kategori" allowClear>
                  {menuData.categories.map(c => <Select.Option key={c.id} value={c.id}>{c.name}</Select.Option>)}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}><Form.Item name="image_url" label="URL Gambar"><Input placeholder="https://..." /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={8}><Form.Item name="sort_order" label="Urutan"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={8}><Form.Item name="stock_count" label="Stok (kosong=∞)"><InputNumber min={0} placeholder="∞" style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={8}><Form.Item name="labels" label="Label" extra="Pisah dengan koma"><Input placeholder="best_seller, new" /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="is_available" valuePropName="checked" initialValue={true}><Switch checkedChildren="Tersedia" unCheckedChildren="Habis" /></Form.Item></Col>
            <Col span={12}><Form.Item name="is_featured" valuePropName="checked"><Switch checkedChildren="⭐ Featured" unCheckedChildren="Normal" /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
}

function ReviewItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <span style={{ color: "#94a3b8", fontSize: 12 }}>{label}</span>
      <p style={{ margin: 0, fontWeight: 500 }}>{value ?? "—"}</p>
    </div>
  );
}
