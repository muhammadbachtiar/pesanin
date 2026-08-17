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
import { getStaffByTenant, createStaffAccount, toggleStaffActive, ROLE_LABEL, ROLE_COLOR } from "@/services/staffService";
import type { StaffListItem } from "@/services/staffService";
import { useRouter } from "next/navigation";
import type { Tenant, Category, Product, BusinessLogic, FinanceConfig, ReceiptConfig, ManualPaymentChannel, UserRole } from "@/types";

const STEPS = ["Identitas & Branding", "Konfigurasi Bisnis", "Akun Owner", "Review & Selesai"];

type WizardData = {
  name: string; slug: string; subtitle: string; description: string; logo_url: string;
  primary_color: string; secondary_color: string;
  payment_timing: "prepaid" | "postpaid"; payment_mode: "gateway" | "manual";
  numbering: "queue" | "table"; require_cashier_verification: boolean;
  pos_only: boolean;
  tax_percentage: number; service_charge_percentage: number; takeaway_fee: number;
  receipt_header: string; receipt_footer: string;
  owner_name: string; owner_email: string; owner_password: string;
};

const DEFAULT_WIZARD: WizardData = {
  name: "", slug: "", subtitle: "", description: "", logo_url: "",
  primary_color: "#6366f1", secondary_color: "#a5b4fc",
  payment_timing: "prepaid", payment_mode: "manual",
  numbering: "queue", require_cashier_verification: false,
  pos_only: false,
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
  const [staffForm] = Form.useForm();

  // ── Manajemen Akun Staf (Fase 2) ──────────────────────────────────────
  const [staffSection, setStaffSection] = useState(false); // collapsed by default
  const [staffTenantFilter, setStaffTenantFilter] = useState<string | null>(null);
  const [staffList, setStaffList] = useState<StaffListItem[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [staffModalOpen, setStaffModalOpen] = useState(false);
  const [staffSaving, setStaffSaving] = useState(false);

  const loadStaff = useCallback(async (tenantId: string | null) => {
    setStaffLoading(true);
    if (tenantId) {
      const data = await getStaffByTenant(tenantId);
      setStaffList(data);
    } else {
      // Load semua tenant satu per satu dan gabungkan (Super Admin)
      const all: StaffListItem[] = [];
      for (const t of tenants) {
        const data = await getStaffByTenant(t.id);
        all.push(...data);
      }
      setStaffList(all);
    }
    setStaffLoading(false);
  }, [tenants]);

  const handleCreateStaff = async (values: { email: string; password: string; fullName: string; role: UserRole; tenantId: string }) => {
    setStaffSaving(true);
    const result = await createStaffAccount({
      email: values.email,
      password: values.password,
      fullName: values.fullName,
      role: values.role,
      tenantId: values.tenantId || null,
    });
    setStaffSaving(false);
    if (!result.success) {
      message.error(result.error ?? "Gagal membuat akun");
      return;
    }
    message.success("Akun staf berhasil dibuat!");
    setStaffModalOpen(false);
    staffForm.resetFields();
    await loadStaff(staffTenantFilter);
  };

  const handleToggleStaff = async (profileId: string, currentActive: boolean) => {
    const ok = await toggleStaffActive(profileId, !currentActive);
    if (ok) {
      message.success(currentActive ? "Akun dinonaktifkan" : "Akun diaktifkan");
      await loadStaff(staffTenantFilter);
    } else {
      message.error("Gagal mengubah status akun");
    }
  };
  // ─────────────────────────────────────────────────────────────────────

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
    step2Form.setFieldsValue({ payment_timing: "prepaid", payment_mode: "manual", numbering: "queue", require_cashier_verification: false, pos_only: false, tax_percentage: 11, service_charge_percentage: 5, takeaway_fee: 2000, receipt_footer: "Terima kasih atas kunjungan Anda!" });
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
      pos_only: t.business_logic.pos_only ?? false,
      tax_percentage: t.finance_config.tax_percentage, service_charge_percentage: t.finance_config.service_charge_percentage,
      takeaway_fee: t.finance_config.takeaway_fee,
      receipt_header: t.receipt_config.header_text, receipt_footer: t.receipt_config.footer_text,
    });
    step1Form.setFieldsValue({ name: t.name, slug: t.slug, subtitle: t.subtitle, description: t.description, logo_url: t.logo_url, primary_color: t.visual_config.primary_color, secondary_color: t.visual_config.secondary_color });
    step2Form.setFieldsValue({ payment_timing: t.business_logic.payment_timing, payment_mode: t.business_logic.payment_mode, numbering: t.business_logic.numbering, require_cashier_verification: t.business_logic.require_cashier_verification, pos_only: t.business_logic.pos_only ?? false, tax_percentage: t.finance_config.tax_percentage, service_charge_percentage: t.finance_config.service_charge_percentage, takeaway_fee: t.finance_config.takeaway_fee, receipt_header: t.receipt_config.header_text, receipt_footer: t.receipt_config.footer_text });
    setWizardStep(0);
    setWizardOpen(true);
  };

  const mergeStep = (vals: Partial<WizardData>) => setWizardData((p) => ({ ...p, ...vals }));

  const nextStep = async () => {
    if (wizardStep === 0) {
      try { const v = await step1Form.validateFields(); mergeStep(v); setWizardStep(1); } catch { }
    } else if (wizardStep === 1) {
      try { const v = await step2Form.validateFields(); mergeStep(v); setWizardStep(editingTenant ? 3 : 2); } catch { }
    } else if (wizardStep === 2) {
      try { const v = await step3Form.validateFields(); mergeStep(v); setWizardStep(3); } catch { }
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
    business_logic: { payment_timing: d.pos_only ? "prepaid" : d.payment_timing, payment_mode: d.payment_mode, numbering: d.numbering, require_cashier_verification: d.require_cashier_verification, pos_only: d.pos_only } as BusinessLogic,
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
          {t.business_logic.pos_only
            ? <Tag color="purple" style={{ fontWeight: 700 }}>🏪 POS</Tag>
            : <Tag>{t.business_logic.payment_timing === "prepaid" ? "Bayar Dulu" : "Pay Later"}</Tag>
          }
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
      render: (_: unknown, t: Tenant) => {
        const isPos = t.business_logic.pos_only === true;
        return (
          <Space wrap size={4}>
            <Tooltip title="Edit Tenant"><Button icon={<EditOutlined />} size="small" onClick={() => openEdit(t)} /></Tooltip>
            <Tooltip title="Kelola Menu"><Button icon={<BookOutlined />} size="small" onClick={() => openMenu(t)}>Menu</Button></Tooltip>
            <Tooltip title="Buka Kiosk"><Button size="small" onClick={() => window.open(`/${t.slug}/kiosk`, "_blank")}>Kiosk</Button></Tooltip>
            <Tooltip title="Buka Kasir"><Button size="small" onClick={() => window.open(`/${t.slug}/cashier`, "_blank")}>Kasir</Button></Tooltip>
            {!isPos && (
              <>
                <Tooltip title="Buka Dapur"><Button size="small" onClick={() => window.open(`/${t.slug}/kitchen`, "_blank")}>Dapur</Button></Tooltip>
                <Tooltip title="Buka Runner"><Button size="small" onClick={() => window.open(`/${t.slug}/runner`, "_blank")}>Runner</Button></Tooltip>
              </>
            )}
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
        );
      },
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
    <Form
      key="s2"
      form={step2Form}
      layout="vertical"
      requiredMark="optional"
      onValuesChange={(changedValues) => {
        if (changedValues.pos_only !== undefined) {
          if (changedValues.pos_only) {
            step2Form.setFieldsValue({
              payment_timing: "prepaid",
              require_cashier_verification: false,
            });
          }
        }
      }}
    >
      <Divider style={{ margin: "0 0 16px", fontSize: 13 }}>Mode Operasional</Divider>
      <Form.Item
        name="pos_only"
        valuePropName="checked"
        label={
          <span style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 18 }}>🏪</span> Aktifkan Mode POS (Standalone)
          </span>
        }
        extra=""
      >
        <Switch checkedChildren="POS Aktif" unCheckedChildren="Normal" />
      </Form.Item>
      <div style={{ background: "#faf5ff", border: "1px solid #d8b4fe", borderRadius: 10, padding: "12px 16px", marginBottom: 16, marginTop: -4 }}>
        <p style={{ margin: 0, color: "#6b21a8", fontSize: 12, lineHeight: 1.7 }}>
          <b>🏪 Mode POS (Kafe/Resto Cepat Saji & Toko):</b> Cocok untuk outlet tanpa alur dapur terpisah.<br />
          Saat diaktifkan: <b>Wajib Pre-paid (Bayar di Depan)</b>, pesanan otomatis <b>Selesai</b> setelah lunas, dan Kasir dilengkapi tab <b>Antrian Bayar (Kiosk/Self-Order)</b> & <b>Riwayat Transaksi</b>.
        </p>
      </div>

      <Divider style={{ margin: "12px 0 16px", fontSize: 13 }}>Alur Pembayaran & Penomoran</Divider>
      <Row gutter={12}>
        <Col span={12}>
          <Form.Item
            noStyle
            shouldUpdate={(prev, cur) => prev.pos_only !== cur.pos_only}
          >
            {({ getFieldValue }) => {
              const posActive = getFieldValue("pos_only");
              return (
                <Form.Item
                  name="payment_timing"
                  label="Waktu Bayar"
                  rules={[{ required: true }]}
                  extra={posActive ? "Terkunci: Mode POS wajib bayar di awal (Pre-paid)" : undefined}
                >
                  <Select size="large" disabled={posActive}>
                    <Select.Option value="prepaid">💳 Bayar di Depan (Prepaid)</Select.Option>
                    <Select.Option value="postpaid">🍽️ Bayar Setelah Makan (Postpaid)</Select.Option>
                  </Select>
                </Form.Item>
              );
            }}
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
              <Select.Option value="queue">🔢 Nomor Antrian (Cocok untuk POS / Kafe)</Select.Option>
              <Select.Option value="table">🪑 Nomor Meja (Dine-in Kafe/Resto)</Select.Option>
            </Select>
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item
            noStyle
            shouldUpdate={(prev, cur) => prev.pos_only !== cur.pos_only}
          >
            {({ getFieldValue }) => {
              const posActive = getFieldValue("pos_only");
              return (
                <Form.Item
                  name="require_cashier_verification"
                  label="Verifikasi Kasir"
                  valuePropName="checked"
                  extra={posActive ? "Nonaktif: Transaksi POS diverifikasi via pembayaran" : "Kasir approve sebelum masuk dapur (cocok untuk postpaid)"}
                >
                  <Switch checkedChildren="Aktif" unCheckedChildren="Nonaktif" disabled={posActive} />
                </Form.Item>
              );
            }}
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
          <Col span={12}><ReviewItem label="Mode Operasional" value={wizardData.pos_only ? "🏪 POS (Standalone)" : "Normal (Kafe/Resto)"} /></Col>
          <Col span={12}><ReviewItem label="Waktu Bayar" value={wizardData.pos_only ? "Pre-Paid (Otomatis)" : wizardData.payment_timing === "prepaid" ? "Bayar di Depan" : "Pay Later"} /></Col>
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
    <div className="min-h-screen font-sans" style={{ background: "#f8fafc" }}>

      {/* ─── Header ─── */}
      <header style={{ background: "#09090b", borderBottom: "1px solid #1f2937", padding: "0 28px", height: 60, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Logo mark */}
          <div style={{ width: 34, height: 34, borderRadius: 9, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 14px rgba(99,102,241,.4)" }}>
            <ShopOutlined style={{ color: "#fff", fontSize: 16 }} />
          </div>
          <span style={{ color: "#fff", fontWeight: 800, fontSize: 18, letterSpacing: "-0.5px" }}>Pesanin</span>
          <span style={{ background: "rgba(99,102,241,.15)", color: "#818cf8", fontSize: 10, fontWeight: 700, padding: "2px 10px", borderRadius: 9999, border: "1px solid rgba(99,102,241,.25)", letterSpacing: "0.06em" }}>SUPER ADMIN</span>
        </div>
        <button
          onClick={handleLogout}
          style={{ display: "flex", alignItems: "center", gap: 6, color: "#9ca3af", background: "transparent", border: "1px solid #374151", borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.15s" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = "#6b7280"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "#9ca3af"; e.currentTarget.style.borderColor = "#374151"; }}
        >
          <LogoutOutlined style={{ fontSize: 13 }} />
          Keluar
        </button>
      </header>

      <div style={{ padding: "28px 32px", maxWidth: 1320, margin: "0 auto" }}>

        {/* ─── Page Title ─── */}
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} style={{ marginBottom: 28 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.5px" }}>Manajemen Tenant</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748b" }}>Kelola semua outlet, konfigurasi bisnis, dan akses sistem Pesanin.</p>
        </motion.div>

        {/* ─── Stats Row ─── */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <Row gutter={16} style={{ marginBottom: 24 }}>
            {[
              { title: "Total Tenant", value: tenants.length, accent: "#6366f1", sub: "terdaftar di sistem" },
              { title: "Aktif", value: activeTenants, accent: "#10b981", sub: "sedang beroperasi" },
              { title: "Nonaktif", value: tenants.length - activeTenants, accent: "#ef4444", sub: "sementara dimatikan" },
            ].map((s) => (
              <Col xs={24} sm={8} key={s.title}>
                <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: "18px 20px", borderLeft: `3px solid ${s.accent}`, boxShadow: "0 1px 4px rgba(0,0,0,.04)" }}>
                  <p style={{ margin: "0 0 4px", fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>{s.title}</p>
                  <p style={{ margin: "0 0 2px", fontSize: 30, fontWeight: 800, color: "#0f172a", lineHeight: 1 }}>{s.value}</p>
                  <p style={{ margin: 0, fontSize: 12, color: "#94a3b8" }}>{s.sub}</p>
                </div>
              </Col>
            ))}
          </Row>
        </motion.div>

        {/* ─── Tenant Table ─── */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", boxShadow: "0 1px 4px rgba(0,0,0,.04)", overflow: "hidden" }}>
            {/* Table Header Bar */}
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <ShopOutlined style={{ color: "#6366f1", fontSize: 15 }} />
                </div>
                <div>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#0f172a" }}>Daftar Tenant</p>
                  <p style={{ margin: 0, fontSize: 12, color: "#94a3b8" }}>{tenants.length} outlet terdaftar</p>
                </div>
              </div>
              <button
                onClick={openAdd}
                style={{ display: "flex", alignItems: "center", gap: 7, background: "#09090b", color: "#fff", border: "none", borderRadius: 9, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,.12)", transition: "opacity .15s" }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
              >
                <PlusOutlined style={{ fontSize: 12 }} />
                Tambah Tenant
              </button>
            </div>
            <Table
              dataSource={tenants}
              columns={columns}
              rowKey="id"
              loading={loading}
              pagination={{ pageSize: 10, showSizeChanger: false }}
              locale={{ emptyText: <Empty description="Belum ada tenant" /> }}
              style={{ margin: 0 }}
            />
          </div>
        </motion.div>

        {/* ─── Manajemen Akun Staf (Fase 2) ─── */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} style={{ marginTop: 24 }}>
          <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", boxShadow: "0 1px 4px rgba(0,0,0,.04)", overflow: "hidden" }}>
            {/* Section header — collapsible */}
            <div
              style={{ padding: "16px 20px", borderBottom: staffSection ? "1px solid #f1f5f9" : "none", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", userSelect: "none" }}
              onClick={() => {
                if (!staffSection) loadStaff(staffTenantFilter);
                setStaffSection(!staffSection);
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <UserOutlined style={{ color: "#6366f1", fontSize: 15 }} />
                </div>
                <div>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#0f172a" }}>Manajemen Akun Staf</p>
                  <p style={{ margin: 0, fontSize: 12, color: "#94a3b8" }}>Buat & kelola akun Kasir, Dapur, Runner, dan Owner untuk semua tenant</p>
                </div>
              </div>
              <span style={{ fontSize: 13, color: "#6366f1", fontWeight: 700 }}>{staffSection ? "▲ Tutup" : "▼ Buka"}</span>
            </div>

            {staffSection && (
              <div style={{ padding: "20px" }}>
                {/* Toolbar */}
                <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
                  <Select
                    placeholder="Filter Tenant"
                    style={{ width: 220 }}
                    allowClear
                    value={staffTenantFilter}
                    onChange={(v) => { setStaffTenantFilter(v ?? null); loadStaff(v ?? null); }}
                    options={[
                      { value: null, label: "Semua Tenant" },
                      ...tenants.map((t) => ({ value: t.id, label: t.name })),
                    ]}
                  />
                  <button
                    onClick={() => { staffForm.resetFields(); setStaffModalOpen(true); }}
                    style={{ display: "flex", alignItems: "center", gap: 7, background: "#09090b", color: "#fff", border: "none", borderRadius: 9, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                  >
                    <PlusOutlined style={{ fontSize: 12 }} /> Tambah Akun Staf
                  </button>
                </div>

                {/* Staff Table */}
                <Table
                  dataSource={staffList}
                  rowKey="id"
                  loading={staffLoading}
                  size="small"
                  pagination={{ pageSize: 10, showSizeChanger: false }}
                  locale={{ emptyText: <Empty description="Belum ada akun staf" /> }}
                  columns={[
                    {
                      title: "Nama", dataIndex: "full_name",
                      render: (v: string | null) => <span style={{ fontWeight: 600, color: "#0f172a" }}>{v ?? "(Tanpa Nama)"}</span>,
                    },
                    {
                      title: "Role", dataIndex: "role",
                      render: (r: UserRole) => {
                        const c = ROLE_COLOR[r];
                        return <Tag style={{ background: c.bg, color: c.text, border: "none", fontWeight: 700 }}>{ROLE_LABEL[r]}</Tag>;
                      },
                    },
                    {
                      title: "Tenant", dataIndex: "tenant_id",
                      render: (tid: string | null) => {
                        if (!tid) return <Tag color="purple">Platform</Tag>;
                        const t = tenants.find((x) => x.id === tid);
                        return <span style={{ fontSize: 12, color: "#64748b" }}>{t?.name ?? tid.slice(0, 8)}</span>;
                      },
                    },
                    {
                      title: "Status", dataIndex: "is_active",
                      render: (v: boolean) => <Tag color={v ? "success" : "default"}>{v ? "Aktif" : "Nonaktif"}</Tag>,
                    },
                    {
                      title: "Aksi", width: 100,
                      render: (_: unknown, r: StaffListItem) => (
                        <button
                          onClick={() => handleToggleStaff(r.id, r.is_active)}
                          style={{ background: r.is_active ? "#fee2e2" : "#d1fae5", color: r.is_active ? "#b91c1c" : "#065f46", border: "none", borderRadius: 7, padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                        >
                          {r.is_active ? "Nonaktifkan" : "Aktifkan"}
                        </button>
                      ),
                    },
                  ]}
                />
              </div>
            )}
          </div>
        </motion.div>
      </div>

      {/* ─── Modal: Tambah Akun Staf ─── */}
      <Modal
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <UserOutlined style={{ color: "#6366f1" }} />
            <span style={{ fontWeight: 800 }}>Tambah Akun Staf Baru</span>
          </div>
        }
        open={staffModalOpen}
        onCancel={() => { setStaffModalOpen(false); staffForm.resetFields(); }}
        footer={null}
        width={480}
        destroyOnHidden
      >
        <Form form={staffForm} layout="vertical" onFinish={handleCreateStaff} style={{ marginTop: 12 }}>
          <Form.Item name="tenantId" label="Outlet / Tenant" rules={[{ required: true, message: "Pilih tenant" }]}>
            <Select
              placeholder="Pilih tenant..."
              options={[
                ...tenants.map((t) => ({ value: t.id, label: `${t.name} (${t.slug})` })),
                { value: "", label: "Platform (hanya untuk Super Admin)" },
              ]}
            />
          </Form.Item>
          <Form.Item name="role" label="Role" rules={[{ required: true, message: "Pilih role" }]}>
            <Select placeholder="Pilih role..." options={[
              { value: "OWNER",   label: "🏢 Admin Outlet (Owner)" },
              { value: "CASHIER", label: "🏪 Kasir" },
              { value: "KITCHEN", label: "👨‍🍳 Dapur" },
              { value: "RUNNER",  label: "🏃 Runner" },
              { value: "SUPER_ADMIN", label: "👑 Super Admin (hati-hati)" },
            ]} />
          </Form.Item>
          <Form.Item name="fullName" label="Nama Lengkap">
            <Input placeholder="Ahmad Barista" prefix={<UserOutlined />} />
          </Form.Item>
          <Form.Item name="email" label="Email Login" rules={[{ required: true, type: "email", message: "Email tidak valid" }]}>
            <Input placeholder="kasir@kafe.com" />
          </Form.Item>
          <Form.Item
            name="password"
            label="Password Awal"
            rules={[{ required: true, min: 8, message: "Minimal 8 karakter" }]}
            extra="Staff dapat mengubah password setelah login"
          >
            <Input.Password placeholder="Min. 8 karakter" />
          </Form.Item>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
            <Button onClick={() => { setStaffModalOpen(false); staffForm.resetFields(); }}>Batal</Button>
            <Button type="primary" htmlType="submit" loading={staffSaving} style={{ background: "#09090b" }}>Buat Akun</Button>
          </div>
        </Form>
      </Modal>

      {/* ─── Wizard Modal ─── */}
      <Modal
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "2px 0" }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: editingTenant ? "#f0f4ff" : "#09090b", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {editingTenant
                ? <EditOutlined style={{ color: "#6366f1", fontSize: 14 }} />
                : <PlusOutlined style={{ color: "#fff", fontSize: 14 }} />
              }
            </div>
            <div>
              <p style={{ margin: 0, fontWeight: 800, fontSize: 15, color: "#0f172a", lineHeight: 1.2 }}>
                {editingTenant ? `Edit Tenant: ${editingTenant.name}` : "Tambah Tenant Baru"}
              </p>
              <p style={{ margin: 0, fontSize: 12, color: "#94a3b8" }}>{STEPS[Math.min(wizardStep, 3)]}</p>
            </div>
          </div>
        }
        open={wizardOpen}
        onCancel={() => setWizardOpen(false)}
        footer={null}
        width={660}
        destroyOnHidden
        styles={{ header: { borderBottom: "1px solid #f1f5f9", paddingBottom: 14 } }}
      >
        {/* Steps indicator */}
        <Steps
          current={wizardStep}
          size="small"
          style={{ marginBottom: 22, marginTop: 6 }}
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
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 24, paddingTop: 16, borderTop: "1px solid #f1f5f9" }}>
          <button
            onClick={wizardStep === 0 ? () => setWizardOpen(false) : prevStep}
            style={{ display: "flex", alignItems: "center", gap: 6, color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all .15s" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#f1f5f9"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#f8fafc"; }}
          >
            {wizardStep !== 0 && <ArrowLeftOutlined style={{ fontSize: 12 }} />}
            {wizardStep === 0 ? "Batal" : "Kembali"}
          </button>

          <div style={{ display: "flex", gap: 8 }}>
            {wizardStep === 2 && !editingTenant && (
              <button
                onClick={() => setWizardStep(3)}
                style={{ color: "#64748b", background: "transparent", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >
                Lewati (owner nanti)
              </button>
            )}
            {wizardStep < (editingTenant ? 1 : 2) && (
              <button
                onClick={nextStep}
                style={{ display: "flex", alignItems: "center", gap: 6, color: "#fff", background: "#09090b", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,.12)", transition: "opacity .15s" }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
              >
                Lanjut <ArrowRightOutlined style={{ fontSize: 12 }} />
              </button>
            )}
            {((wizardStep === 2 && !editingTenant) || (wizardStep === 1 && editingTenant)) && (
              <button
                onClick={nextStep}
                style={{ display: "flex", alignItems: "center", gap: 6, color: "#fff", background: "#09090b", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,.12)", transition: "opacity .15s" }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
              >
                {editingTenant ? "Review" : "Lanjut"} <ArrowRightOutlined style={{ fontSize: 12 }} />
              </button>
            )}
            {wizardStep === 3 && (
              <button
                onClick={handleSubmit}
                disabled={saving}
                style={{ display: "flex", alignItems: "center", gap: 6, color: "#fff", background: saving ? "#94a3b8" : "#10b981", border: "none", borderRadius: 8, padding: "8px 20px", fontSize: 13, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", boxShadow: saving ? "none" : "0 2px 10px rgba(16,185,129,.3)", transition: "all .15s" }}
              >
                {saving ? (
                  <><svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity=".25" /><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" opacity=".75" /></svg> Menyimpan...</>
                ) : (
                  <><CheckOutlined style={{ fontSize: 12 }} /> {editingTenant ? "Simpan Perubahan" : "Buat Tenant"}</>
                )}
              </button>
            )}
          </div>
        </div>
      </Modal>

      {/* ─── Menu Drawer ─── */}
      <Drawer
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 7, background: "#f0f4ff", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <BookOutlined style={{ color: "#6366f1", fontSize: 13 }} />
            </div>
            <div>
              <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#0f172a" }}>Kelola Menu</p>
              <p style={{ margin: 0, fontSize: 12, color: "#94a3b8" }}>{menuDrawer.tenant?.name}</p>
            </div>
          </div>
        }
        placement="right"
        size="large"
        open={menuDrawer.open}
        onClose={() => setMenuDrawer({ open: false, tenant: null })}
        extra={
          <Space>
            <button
              onClick={() => setMenuTab("categories")}
              style={{ display: "flex", alignItems: "center", gap: 5, color: menuTab === "categories" ? "#fff" : "#64748b", background: menuTab === "categories" ? "#09090b" : "#f8fafc", border: `1px solid ${menuTab === "categories" ? "#09090b" : "#e2e8f0"}`, borderRadius: 7, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", transition: "all .15s" }}
            >
              <AppstoreOutlined /> Kategori ({menuData.categories.length})
            </button>
            <button
              onClick={() => setMenuTab("products")}
              style={{ display: "flex", alignItems: "center", gap: 5, color: menuTab === "products" ? "#fff" : "#64748b", background: menuTab === "products" ? "#09090b" : "#f8fafc", border: `1px solid ${menuTab === "products" ? "#09090b" : "#e2e8f0"}`, borderRadius: 7, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", transition: "all .15s" }}
            >
              <BookOutlined /> Produk ({menuData.products.length})
            </button>
          </Space>
        }
      >
        <AnimatePresence mode="wait">
          {menuTab === "categories" ? (
            <motion.div key="cats" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
                <button
                  onClick={() => { setEditingCat(null); catForm.resetFields(); setCatModalOpen(true); }}
                  style={{ display: "flex", alignItems: "center", gap: 6, color: "#fff", background: "#09090b", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                >
                  <PlusOutlined style={{ fontSize: 12 }} /> Tambah Kategori
                </button>
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
                        <Button size="small" icon={<EditOutlined />} onClick={() => { setEditingCat(r); setCatModalOpen(true); }} />
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
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
                <button
                  onClick={() => { setEditingProd(null); setProdModalOpen(true); }}
                  style={{ display: "flex", alignItems: "center", gap: 6, color: "#fff", background: "#09090b", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                >
                  <PlusOutlined style={{ fontSize: 12 }} /> Tambah Produk
                </button>
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
                        <Button size="small" icon={<EditOutlined />} onClick={() => { setEditingProd(r); setProdModalOpen(true); }} />
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

      {/* ─── Category Modal ─── */}
      <Modal
        title={<span style={{ fontWeight: 700 }}>{editingCat ? "Edit Kategori" : "Tambah Kategori"}</span>}
        open={catModalOpen}
        onCancel={() => { setCatModalOpen(false); setEditingCat(null); }}
        onOk={() => catForm.submit()} okText="Simpan"
        okButtonProps={{ style: { background: "#09090b", borderColor: "#09090b" } }}
      >
        <Form form={catForm} onFinish={saveCat} layout="vertical">
          <Form.Item name="name" label="Nama Kategori" rules={[{ required: true }]}><Input placeholder="Kopi Panas" /></Form.Item>
          <Form.Item name="sort_order" label="Urutan Tampil"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="is_active" label="Aktif" valuePropName="checked"><Switch /></Form.Item>
        </Form>
      </Modal>

      {/* ─── Product Modal ─── */}
      <Modal
        title={<span style={{ fontWeight: 700 }}>{editingProd ? "Edit Produk" : "Tambah Produk"}</span>}
        open={prodModalOpen}
        onCancel={() => { setProdModalOpen(false); setEditingProd(null); }}
        onOk={() => prodForm.submit()} okText="Simpan" width={560}
        okButtonProps={{ style: { background: "#09090b", borderColor: "#09090b" } }}
      >
        <Form form={prodForm} onFinish={saveProd} layout="vertical" requiredMark="optional">
          <Row gutter={12}>
            <Col span={16}><Form.Item name="name" label="Nama Produk" rules={[{ required: true }]}><Input placeholder="Espresso" /></Form.Item></Col>
            <Col span={8}><Form.Item name="base_price" label="Harga (Rp)" rules={[{ required: true }]}><InputNumber min={0}
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
    <div style={{ marginBottom: 10 }}>
      <span style={{ display: "block", color: "#94a3b8", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>{label}</span>
      <p style={{ margin: 0, fontWeight: 600, fontSize: 13, color: "#0f172a" }}>{value ?? "—"}</p>
    </div>
  );
}
