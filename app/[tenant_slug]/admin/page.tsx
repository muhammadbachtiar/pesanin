"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Table,
  Tag,
  Button,
  Modal,
  Form,
  Input,
  Select,
  Switch,
  InputNumber,
  Tabs,
  Popconfirm,
  message,
  Card,
  Row,
  Col,
  Space,
} from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import { getTenantBySlug, updateTenant } from "@/services/tenantService";
import { toggleProductAvailability } from "@/services/productService";
import {
  getStaffByTenant,
  createStaffAccount,
  toggleStaffActive,
  deleteStaffAccount,
  setStaffPin,
  ROLE_LABEL,
  ROLE_COLOR,
} from "@/services/staffService";
import { TenantRoleGuard } from "@/components/auth/TenantRoleGuard";
import ImageUploadField from "@/components/ImageUploadField";
import { supabase } from "@/lib/supabase";
import type {
  Tenant,
  Category,
  Product,
  Profile,
  UserRole,
  ManualPaymentChannel,
  FinanceConfig,
  ReceiptConfig,
} from "@/types";

export default function TenantAdminPage({ params }: { params: Promise<{ tenant_slug: string }> }) {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [staffList, setStaffList] = useState<Profile[]>([]);
  const [loadingStaff, setLoadingStaff] = useState(false);
  const [loadingMenu, setLoadingMenu] = useState(false);
  const [activeTab, setActiveTab] = useState("staff");

  // Staff Modal
  const [staffModalOpen, setStaffModalOpen] = useState(false);
  const [staffSubmitting, setStaffSubmitting] = useState(false);
  const [staffForm] = Form.useForm();

  // PIN Modal (atur / ganti / hapus PIN Quick Login staf)
  const [pinModal, setPinModal] = useState<{ open: boolean; staff: (Profile & { has_pin?: boolean }) | null }>({
    open: false,
    staff: null,
  });
  const [pinSubmitting, setPinSubmitting] = useState(false);
  const [pinForm] = Form.useForm();

  // Category CRUD Modal
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<Category | null>(null);
  const [catSubmitting, setCatSubmitting] = useState(false);
  const [catForm] = Form.useForm();

  // Product CRUD Modal
  const [prodModalOpen, setProdModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productSubmitting, setProductSubmitting] = useState(false);
  const [productForm] = Form.useForm();

  // Branding & QRIS Outlet State
  const [outletLogoUrl, setOutletLogoUrl] = useState("");
  const [outletQrisUrl, setOutletQrisUrl] = useState("");
  const [savingBranding, setSavingBranding] = useState(false);

  // Finance (PB1, Service Charge, Takeaway Fee) & Receipt Config State
  const [financeForm] = Form.useForm();
  const [savingFinance, setSavingFinance] = useState(false);

  const [togglingProductMap, setTogglingProductMap] = useState<Record<string, boolean>>({});
  const lockRef = useRef<Record<string, boolean>>({});

  const loadMenuAndCategories = useCallback(async (tenantId: string) => {
    setLoadingMenu(true);
    try {
      const res = await fetch(`/api/admin/tenants/${tenantId}/menu`);
      if (res.ok) {
        const data = await res.json();
        setCategories(data.categories ?? []);
        setProducts(data.products ?? []);
      }
    } catch (err) {
      console.error("loadMenuAndCategories error:", err);
      message.error("Gagal memuat katalog menu & kategori");
    } finally {
      setLoadingMenu(false);
    }
  }, []);

  const loadData = useCallback(
    async (tenantId: string) => {
      setLoadingStaff(true);
      try {
        const [staffs] = await Promise.all([
          getStaffByTenant(tenantId),
          loadMenuAndCategories(tenantId),
        ]);
        setStaffList(staffs);
      } catch (err) {
        console.error("Error loading admin data:", err);
        message.error("Gagal memuat data outlet");
      } finally {
        setLoadingStaff(false);
      }
    },
    [loadMenuAndCategories]
  );

  useEffect(() => {
    async function init() {
      const { tenant_slug } = await params;
      const t = await getTenantBySlug(tenant_slug);
      if (!t) return;
      setTenant(t);
      setOutletLogoUrl(t.logo_url ?? "");
      const qrisChan = t.manual_payment_channels?.find((c) => c.type === "qris_static");
      setOutletQrisUrl(qrisChan?.image_url ?? "");
      financeForm.setFieldsValue({
        tax_percentage: t.finance_config?.tax_percentage ?? 0,
        service_charge_percentage: t.finance_config?.service_charge_percentage ?? 0,
        takeaway_fee: t.finance_config?.takeaway_fee ?? 0,
        paper_size: t.receipt_config?.paper_size ?? "58mm",
        header_text: t.receipt_config?.header_text ?? "",
        footer_text: t.receipt_config?.footer_text ?? "Terima kasih atas kunjungan Anda!",
      });
      await loadData(t.id);
    }
    init();
  }, [params, loadData, financeForm]);

  // Populate Category Modal
  useEffect(() => {
    if (!catModalOpen) return;
    if (editingCat) {
      catForm.setFieldsValue({
        name: editingCat.name,
        sort_order: editingCat.sort_order ?? 0,
        is_active: editingCat.is_active ?? true,
        image_url: editingCat.image_url ?? "",
      });
    } else {
      catForm.resetFields();
      catForm.setFieldsValue({
        sort_order: categories.length,
        is_active: true,
        image_url: "",
      });
    }
  }, [catModalOpen, editingCat, catForm, categories.length]);

  // Populate Product Modal
  useEffect(() => {
    if (!prodModalOpen) return;
    if (editingProduct) {
      productForm.setFieldsValue({
        name: editingProduct.name,
        description: editingProduct.description ?? "",
        category_id: editingProduct.category_id ?? undefined,
        base_price: editingProduct.base_price,
        discount_price: editingProduct.discount_price ?? undefined,
        stock_count: editingProduct.stock_count !== null ? editingProduct.stock_count : undefined,
        sort_order: editingProduct.sort_order ?? 0,
        labels: (editingProduct.labels ?? []).join(", "),
        image_url: editingProduct.image_urls?.[0] ?? "",
        is_available: editingProduct.is_available ?? true,
        is_featured: editingProduct.is_featured ?? false,
      });
    } else {
      productForm.resetFields();
      productForm.setFieldsValue({
        sort_order: products.length,
        is_available: true,
        is_featured: false,
        image_url: "",
      });
    }
  }, [prodModalOpen, editingProduct, productForm, products.length]);

  // ── Handler Simpan Branding & QRIS Outlet ──
  const handleSaveOutletAssets = async () => {
    if (!tenant || savingBranding || lockRef.current["saveBranding"]) return;
    lockRef.current["saveBranding"] = true;
    setSavingBranding(true);
    try {
      const currentChannels: ManualPaymentChannel[] =
        Array.isArray(tenant.manual_payment_channels) && tenant.manual_payment_channels.length > 0
          ? tenant.manual_payment_channels
          : [
              {
                id: "ch-001",
                type: "qris_static",
                label: "QRIS / E-Wallet",
                instructions: "Scan QR lalu tunjukkan bukti ke kasir",
              },
              {
                id: "ch-002",
                type: "cash",
                label: "Tunai / Cash",
                instructions: "Bayar langsung ke kasir",
              },
            ];

      let hasQris = false;
      const updatedChannels: ManualPaymentChannel[] = currentChannels.map((ch) => {
        if (ch.type === "qris_static") {
          hasQris = true;
          return { ...ch, image_url: outletQrisUrl.trim() || undefined };
        }
        return ch;
      });

      if (!hasQris && outletQrisUrl.trim()) {
        updatedChannels.unshift({
          id: "ch-001",
          type: "qris_static",
          label: "QRIS / E-Wallet",
          instructions: "Scan QR lalu tunjukkan bukti ke kasir",
          image_url: outletQrisUrl.trim(),
        });
      }

      const nextLogo = outletLogoUrl.trim() || null;
      const ok = await updateTenant(tenant.id, {
        logo_url: nextLogo,
        manual_payment_channels: updatedChannels,
      });

      if (ok) {
        setTenant({
          ...tenant,
          logo_url: nextLogo,
          manual_payment_channels: updatedChannels,
        });
        message.success("Logo outlet & barcode QRIS berhasil diperbarui!");
      } else {
        message.error("Gagal menyimpan aset outlet.");
      }
    } catch (err) {
      console.error("handleSaveOutletAssets error:", err);
      message.error("Terjadi kesalahan saat menyimpan aset outlet.");
    } finally {
      lockRef.current["saveBranding"] = false;
      setSavingBranding(false);
    }
  };

  // ── Handler Simpan Pajak (PB1), Service Charge, Takeaway Fee & Struk ──
  const handleSaveFinanceAndReceipt = async () => {
    if (!tenant || savingFinance || lockRef.current["saveFinance"]) return;
    try {
      const values = await financeForm.validateFields();
      lockRef.current["saveFinance"] = true;
      setSavingFinance(true);

      const nextFinance: FinanceConfig = {
        tax_percentage: Number(values.tax_percentage ?? 0),
        service_charge_percentage: Number(values.service_charge_percentage ?? 0),
        takeaway_fee: Number(values.takeaway_fee ?? 0),
      };

      const nextReceipt: ReceiptConfig = {
        ...(tenant.receipt_config ?? { show_logo: true }),
        paper_size: values.paper_size === "80mm" ? "80mm" : "58mm",
        header_text: (values.header_text ?? "").trim(),
        footer_text: (values.footer_text ?? "").trim(),
        show_logo: tenant.receipt_config?.show_logo ?? true,
      };

      const ok = await updateTenant(tenant.id, {
        finance_config: nextFinance,
        receipt_config: nextReceipt,
      });

      if (ok) {
        setTenant({
          ...tenant,
          finance_config: nextFinance,
          receipt_config: nextReceipt,
        });
        message.success("Pengaturan PB1, Service Charge, Biaya Takeaway & Struk berhasil disimpan!");
      } else {
        message.error("Gagal menyimpan pengaturan keuangan & struk.");
      }
    } catch (err) {
      console.error("handleSaveFinanceAndReceipt error:", err);
    } finally {
      lockRef.current["saveFinance"] = false;
      setSavingFinance(false);
    }
  };

  // ── Handler CRUD Kategori ──
  const handleSaveCategory = async () => {
    if (!tenant || catSubmitting || lockRef.current["saveCategory"]) return;
    try {
      const values = await catForm.validateFields();
      lockRef.current["saveCategory"] = true;
      setCatSubmitting(true);

      const payload = {
        name: values.name.trim(),
        sort_order: Number(values.sort_order ?? 0),
        is_active: Boolean(values.is_active),
        image_url: (values.image_url ?? "").trim() || null,
      };

      const res = await fetch(`/api/admin/tenants/${tenant.id}/menu`, {
        method: editingCat ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editingCat
            ? { _type: "category", _itemId: editingCat.id, ...payload }
            : { _type: "category", ...payload }
        ),
      });

      const data = await res.json();
      if (!res.ok) {
        message.error(data.error || "Gagal menyimpan kategori");
        return;
      }

      message.success(editingCat ? "Kategori berhasil diperbarui!" : "Kategori baru berhasil ditambahkan!");
      setCatModalOpen(false);
      setEditingCat(null);
      catForm.resetFields();
      await loadMenuAndCategories(tenant.id);
    } catch (err) {
      console.error("handleSaveCategory error:", err);
    } finally {
      lockRef.current["saveCategory"] = false;
      setCatSubmitting(false);
    }
  };

  const handleDeleteCategory = async (categoryId: string) => {
    const key = `deleteCat:${categoryId}`;
    if (!tenant || lockRef.current[key]) return;
    lockRef.current[key] = true;
    try {
      const res = await fetch(`/api/admin/tenants/${tenant.id}/menu`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _type: "category", _itemId: categoryId }),
      });
      if (res.ok) {
        message.success("Kategori berhasil dihapus");
        await loadMenuAndCategories(tenant.id);
      } else {
        message.error("Gagal menghapus kategori");
      }
    } finally {
      lockRef.current[key] = false;
    }
  };

  // ── Handler CRUD Menu / Produk ──
  const handleSaveProduct = async () => {
    if (!tenant || productSubmitting || lockRef.current["saveProduct"]) return;
    try {
      const values = await productForm.validateFields();
      lockRef.current["saveProduct"] = true;
      setProductSubmitting(true);

      const discountPrice = values.discount_price ? Number(values.discount_price) : null;
      const stockCount =
        values.stock_count !== undefined && values.stock_count !== null && values.stock_count !== ""
          ? Number(values.stock_count)
          : null;
      const imageUrl = (values.image_url ?? "").trim();
      const labels = ((values.labels as string) ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const payload = {
        name: values.name.trim(),
        description: (values.description ?? "").trim() || null,
        category_id: values.category_id || null,
        base_price: Number(values.base_price),
        discount_price: discountPrice,
        stock_count: stockCount,
        sort_order: Number(values.sort_order ?? 0),
        labels,
        image_urls: imageUrl ? [imageUrl] : [],
        is_featured: Boolean(values.is_featured),
        is_available: stockCount !== null && stockCount <= 0 ? false : Boolean(values.is_available),
      };

      const res = await fetch(`/api/admin/tenants/${tenant.id}/menu`, {
        method: editingProduct ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editingProduct
            ? { _type: "product", _itemId: editingProduct.id, ...payload }
            : { _type: "product", ...payload }
        ),
      });

      const data = await res.json();
      if (!res.ok) {
        message.error(data.error || "Gagal menyimpan menu");
        return;
      }

      message.success(editingProduct ? "Menu berhasil diperbarui!" : "Menu baru berhasil ditambahkan!");
      setProdModalOpen(false);
      setEditingProduct(null);
      productForm.resetFields();
      await loadMenuAndCategories(tenant.id);
    } catch (err) {
      console.error("handleSaveProduct error:", err);
    } finally {
      lockRef.current["saveProduct"] = false;
      setProductSubmitting(false);
    }
  };

  const handleDeleteProduct = async (productId: string) => {
    const key = `deleteProd:${productId}`;
    if (!tenant || lockRef.current[key]) return;
    lockRef.current[key] = true;
    try {
      const res = await fetch(`/api/admin/tenants/${tenant.id}/menu`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _type: "product", _itemId: productId }),
      });
      if (res.ok) {
        message.success("Menu berhasil dihapus permanen");
        await loadMenuAndCategories(tenant.id);
      } else {
        message.error("Gagal menghapus menu");
      }
    } finally {
      lockRef.current[key] = false;
    }
  };

  // ── Handler Tambah Staf ──
  const handleCreateStaff = async () => {
    if (staffSubmitting || lockRef.current["createStaff"]) return;
    try {
      const values = await staffForm.validateFields();
      if (!tenant) return;
      lockRef.current["createStaff"] = true;
      setStaffSubmitting(true);

      const res = await createStaffAccount({
        fullName: values.fullName,
        role: values.role as UserRole,
        email: values.email,
        password: values.password,
        tenantId: tenant.id,
        pin: values.pin || undefined,
      });

      if (!res.success) {
        message.error(res.error || "Gagal membuat akun staf");
        return;
      }

      message.success(`Akun ${ROLE_LABEL[values.role as UserRole]} berhasil dibuat!`);
      staffForm.resetFields();
      setStaffModalOpen(false);
      await loadData(tenant.id);
    } catch (err) {
      console.error("handleCreateStaff error:", err);
    } finally {
      lockRef.current["createStaff"] = false;
      setStaffSubmitting(false);
    }
  };

  // ── Handler Toggle Staf Aktif/Nonaktif ──
  const handleToggleStaff = async (profileId: string, currentActive: boolean) => {
    const key = `toggleStaff:${profileId}`;
    if (lockRef.current[key]) return;
    lockRef.current[key] = true;
    try {
      const ok = await toggleStaffActive(profileId, !currentActive);
      if (ok) {
        message.success(`Status staf berhasil ${!currentActive ? "diaktifkan" : "dinonaktifkan"}`);
        if (tenant) loadData(tenant.id);
      } else {
        message.error("Gagal memperbarui status akun staf");
      }
    } finally {
      lockRef.current[key] = false;
    }
  };

  // ── Handler Hapus Staf Permanen ──
  const handleDeleteStaff = async (profileId: string) => {
    const key = `deleteStaff:${profileId}`;
    if (lockRef.current[key]) return;
    lockRef.current[key] = true;
    try {
      const ok = await deleteStaffAccount(profileId);
      if (ok) {
        message.success("Akun staf berhasil dihapus permanen");
        if (tenant) loadData(tenant.id);
      } else {
        message.error("Gagal menghapus akun staf");
      }
    } finally {
      lockRef.current[key] = false;
    }
  };

  // ── Handler Atur / Hapus PIN Quick Login ──
  const handleSavePin = async (clear = false) => {
    if (pinSubmitting || lockRef.current["savePin"]) return;
    try {
      const staff = pinModal.staff;
      if (!staff) return;
      let pin: string | null = null;
      if (!clear) {
        const values = await pinForm.validateFields();
        pin = values.pin as string;
      }
      lockRef.current["savePin"] = true;
      setPinSubmitting(true);
      const res = await setStaffPin(staff.id, pin);
      if (!res.success) {
        message.error(res.error || "Gagal menyimpan PIN");
        return;
      }
      message.success(clear ? "PIN dihapus. Staf wajib login dengan email." : "PIN berhasil disimpan!");
      pinForm.resetFields();
      setPinModal({ open: false, staff: null });
      if (tenant) loadData(tenant.id);
    } catch (err) {
      console.error("handleSavePin error:", err);
    } finally {
      lockRef.current["savePin"] = false;
      setPinSubmitting(false);
    }
  };

  const staffColumns = [
    {
      title: "Nama Staf",
      dataIndex: "full_name",
      key: "full_name",
      render: (name: string, record: Profile) => (
        <div>
          <div className="font-bold text-gray-900">{name || "Tanpa Nama"}</div>
          <div className="text-[11px] text-gray-400 font-mono">ID: {record.id.slice(0, 8)}...</div>
        </div>
      ),
    },
    {
      title: "Role / Peran",
      dataIndex: "role",
      key: "role",
      render: (role: UserRole) => {
        const color = ROLE_COLOR[role] || { bg: "#f1f5f9", text: "#475569" };
        return (
          <span
            className="text-xs font-bold px-2.5 py-1 rounded-full inline-block"
            style={{ background: color.bg, color: color.text }}
          >
            {ROLE_LABEL[role] || role}
          </span>
        );
      },
    },
    {
      title: "Status Akun",
      dataIndex: "is_active",
      key: "is_active",
      render: (isActive: boolean) => (
        <span
          className={`text-xs font-bold px-2.5 py-1 rounded-full inline-flex items-center gap-1.5 ${
            isActive ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-600"
          }`}
        >
          <span className={`w-2 h-2 rounded-full ${isActive ? "bg-emerald-500" : "bg-gray-400"}`} />
          {isActive ? "Aktif" : "Nonaktif (Dibekukan)"}
        </span>
      ),
    },
    {
      title: "PIN Cepat",
      key: "pin",
      render: (_: unknown, record: Profile & { has_pin?: boolean }) => {
        if (record.role === "OWNER" || record.role === "SUPER_ADMIN") {
          return <span className="text-xs text-gray-400">Wajib Email</span>;
        }
        return (
          <div className="flex items-center gap-2">
            {record.has_pin ? (
              <Tag color="green" className="m-0">🔑 Aktif</Tag>
            ) : (
              <Tag className="m-0">Belum diatur</Tag>
            )}
            <Button
              size="small"
              onClick={() => {
                pinForm.resetFields();
                setPinModal({ open: true, staff: record });
              }}
            >
              {record.has_pin ? "Ganti PIN" : "Atur PIN"}
            </Button>
          </div>
        );
      },
    },
    {
      title: "Aksi",
      key: "action",
      render: (_: unknown, record: Profile) => (
        <div className="flex items-center gap-2">
          <Switch
            size="small"
            checked={record.is_active}
            onChange={() => handleToggleStaff(record.id, record.is_active)}
            checkedChildren="Aktif"
            unCheckedChildren="Off"
          />
          {record.role !== "OWNER" && (
            <Popconfirm
              title="Hapus akun staf permanen?"
              description="Staf ini tidak akan bisa login lagi ke outlet."
              onConfirm={() => handleDeleteStaff(record.id)}
              okText="Ya, Hapus"
              cancelText="Batal"
              okButtonProps={{ danger: true }}
            >
              <Button danger size="small">
                Hapus
              </Button>
            </Popconfirm>
          )}
        </div>
      ),
    },
  ];

  const categoryColumns = [
    {
      title: "Kategori",
      key: "name",
      render: (_: unknown, cat: Category) => (
        <div className="flex items-center gap-3">
          {cat.image_url ? (
            <img
              src={cat.image_url}
              alt={cat.name}
              className="w-10 h-10 object-cover rounded-xl border flex-shrink-0"
            />
          ) : (
            <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-lg flex-shrink-0">
              📂
            </div>
          )}
          <div>
            <div className="font-bold text-sm text-gray-900">{cat.name}</div>
            <div className="text-[11px] text-gray-400">
              {products.filter((p) => p.category_id === cat.id).length} menu di kategori ini
            </div>
          </div>
        </div>
      ),
    },
    {
      title: "Urutan Tampil",
      dataIndex: "sort_order",
      key: "sort_order",
      width: 140,
      render: (order: number) => <Tag color="blue">Urutan #{order ?? 0}</Tag>,
    },
    {
      title: "Status",
      dataIndex: "is_active",
      key: "is_active",
      width: 140,
      render: (isActive: boolean) => (
        <Tag color={isActive ? "green" : "default"}>{isActive ? "Aktif" : "Nonaktif"}</Tag>
      ),
    },
    {
      title: "Aksi",
      key: "action",
      width: 140,
      render: (_: unknown, cat: Category) => (
        <Space>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => {
              setEditingCat(cat);
              setCatModalOpen(true);
            }}
          >
            Edit
          </Button>
          <Popconfirm
            title="Hapus kategori ini?"
            description="Menu di dalam kategori ini tidak akan terhapus (hanya lepas dari kategori)."
            onConfirm={() => handleDeleteCategory(cat.id)}
            okText="Hapus"
            cancelText="Batal"
            okButtonProps={{ danger: true }}
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const productColumns = [
    {
      title: "Menu & Gambar",
      key: "menu",
      render: (_: unknown, p: Product) => {
        const hasPromo = p.discount_price && p.discount_price > 0 && p.discount_price < p.base_price;
        const discountPct = hasPromo ? Math.round(((p.base_price - p.discount_price!) / p.base_price) * 100) : 0;
        const catName = categories.find((c) => c.id === p.category_id)?.name;
        return (
          <div className="flex items-center gap-3">
            {p.image_urls?.[0] ? (
              <img src={p.image_urls[0]} alt={p.name} className="w-12 h-12 object-cover rounded-xl border flex-shrink-0" />
            ) : (
              <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center text-xl flex-shrink-0">🍽️</div>
            )}
            <div>
              <div className="font-bold text-sm text-gray-900 flex items-center gap-1.5 flex-wrap">
                {p.name}
                {p.is_featured && (
                  <span className="text-[10px] font-black bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                    ⭐ Unggulan
                  </span>
                )}
                {hasPromo && (
                  <span className="text-[10px] font-black bg-rose-500 text-white px-2 py-0.5 rounded-full">
                    🔥 -{discountPct}%
                  </span>
                )}
              </div>
              <div className="text-xs text-gray-400 mt-0.5 line-clamp-1">
                {catName ? <span className="font-semibold text-indigo-600">{catName} · </span> : null}
                {p.description || "Tanpa deskripsi"}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      title: "Harga Dasar",
      dataIndex: "base_price",
      key: "base_price",
      render: (price: number) => <span className="font-semibold text-gray-700">Rp {Number(price).toLocaleString("id-ID")}</span>,
    },
    {
      title: "Harga Promo / Diskon",
      key: "discount_price",
      render: (_: unknown, p: Product) => {
        if (p.discount_price && p.discount_price > 0 && p.discount_price < p.base_price) {
          return (
            <div>
              <span className="font-extrabold text-rose-600 block">Rp {p.discount_price.toLocaleString("id-ID")}</span>
              <span className="text-[10px] text-gray-400 line-through">Rp {p.base_price.toLocaleString("id-ID")}</span>
            </div>
          );
        }
        return <span className="text-xs text-gray-400">Tidak ada promo</span>;
      },
    },
    {
      title: "Sisa Stok",
      dataIndex: "stock_count",
      key: "stock_count",
      render: (stock: number | null) =>
        stock === null ? (
          <span className="text-xs text-gray-500 font-medium">♾️ Tanpa Batas</span>
        ) : (
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${stock <= 5 ? "bg-amber-100 text-amber-800" : "bg-blue-50 text-blue-700"}`}>
            {stock} porsi
          </span>
        ),
    },
    {
      title: "Ketersediaan",
      dataIndex: "is_available",
      key: "is_available",
      render: (isAvailable: boolean, record: Product) => (
        <Switch
          checked={isAvailable}
          loading={!!togglingProductMap[record.id]}
          onChange={async (checked) => {
            const key = `toggleProduct:${record.id}`;
            if (lockRef.current[key]) return;
            lockRef.current[key] = true;
            setTogglingProductMap((prev) => ({ ...prev, [record.id]: true }));
            try {
              await toggleProductAvailability(record.id, checked);
              if (tenant) await loadMenuAndCategories(tenant.id);
            } finally {
              lockRef.current[key] = false;
              setTogglingProductMap((prev) => ({ ...prev, [record.id]: false }));
            }
          }}
          checkedChildren="Tersedia"
          unCheckedChildren="Habis"
        />
      ),
    },
    {
      title: "Aksi",
      key: "action",
      width: 170,
      render: (_: unknown, p: Product) => (
        <Space>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => {
              setEditingProduct(p);
              setProdModalOpen(true);
            }}
          >
            Edit Menu
          </Button>
          <Popconfirm
            title="Hapus menu ini permanen?"
            description="Menu dan fotonya akan dihapus dari katalog outlet."
            onConfirm={() => handleDeleteProduct(p.id)}
            okText="Hapus"
            cancelText="Batal"
            okButtonProps={{ danger: true }}
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  if (!tenant) return null;

  return (
    <TenantRoleGuard
      tenantSlug={tenant.slug}
      tenantId={tenant.id}
      isPosOnly={tenant.business_logic?.pos_only ?? false}
      allowedRoles={["OWNER", "SUPER_ADMIN"]}
    >
      <div className="min-h-screen bg-slate-100 flex flex-col font-sans">
        {/* Top Navbar */}
        <header
          className="px-6 py-4 flex flex-wrap items-center justify-between gap-3 text-white shadow-md"
          style={{ background: "var(--tenant-primary)" }}
        >
          <div className="flex items-center gap-3">
            {tenant.logo_url ? (
              <img src={tenant.logo_url} alt={tenant.name} className="w-10 h-10 rounded-xl bg-white object-contain p-1 shadow" />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center font-black text-xl">🏢</div>
            )}
            <div>
              <h1 className="text-lg font-black leading-none text-white">{tenant.name}</h1>
              <p className="text-xs text-white/80 mt-0.5">Portal Admin Outlet (Owner)</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href="analytics"
              className="text-xs font-bold bg-white/20 hover:bg-white/30 text-white px-3.5 py-2 rounded-xl transition-all"
            >
              📊 Laporan Analytics
            </a>
            <a
              href="cashier"
              className="text-xs font-bold bg-white/15 hover:bg-white/25 text-white px-3.5 py-2 rounded-xl transition-all"
            >
              💳 Layar Kasir
            </a>
            {!tenant.business_logic?.pos_only && (
              <>
                <a
                  href="kitchen"
                  className="text-xs font-bold bg-white/15 hover:bg-white/25 text-white px-3.5 py-2 rounded-xl transition-all"
                >
                  🍳 Layar Dapur
                </a>
                <a
                  href="runner"
                  className="text-xs font-bold bg-white/15 hover:bg-white/25 text-white px-3.5 py-2 rounded-xl transition-all"
                >
                  🏃 Layar Runner
                </a>
              </>
            )}
            <a
              href="kiosk"
              target="_blank"
              rel="noreferrer"
              className="text-xs font-bold bg-white/15 hover:bg-white/25 text-white px-3.5 py-2 rounded-xl transition-all"
            >
              📱 Kiosk Self-Order ↗
            </a>
            <Button
              size="small"
              onClick={async () => {
                await supabase.auth.signOut();
                window.location.href = `/${tenant.slug}/login`;
              }}
              className="ml-2"
            >
              Keluar
            </Button>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 p-6 max-w-7xl w-full mx-auto space-y-6">
          <Card className="shadow-sm rounded-2xl border-0">
            <Tabs
              activeKey={activeTab}
              onChange={setActiveTab}
              items={[
                {
                  key: "staff",
                  label: (
                    <span className="font-bold text-sm flex items-center gap-2">
                      👥 Manajemen Akun Staf ({staffList.length})
                    </span>
                  ),
                  children: (
                    <div className="space-y-4 pt-2">
                      <div className="flex flex-wrap justify-between items-center gap-3">
                        <p className="text-xs text-gray-500 max-w-xl">
                          Buat dan kelola akun login operasional untuk kasir, dapur, dan pelayan outlet ini.
                          Akun yang dinonaktifkan tidak dapat login ke sistem.
                        </p>
                        <Button
                          type="primary"
                          onClick={() => setStaffModalOpen(true)}
                          style={{ background: "var(--tenant-primary)" }}
                          className="font-bold rounded-xl"
                        >
                          ＋ Tambah Akun Staf
                        </Button>
                      </div>

                      <Table
                        dataSource={staffList}
                        columns={staffColumns}
                        rowKey="id"
                        loading={loadingStaff}
                        pagination={false}
                        size="middle"
                      />
                    </div>
                  ),
                },
                {
                  key: "menu",
                  label: (
                    <span className="font-bold text-sm flex items-center gap-2">
                      🍽️ Katalog Menu, Promo &amp; Stok ({products.length})
                    </span>
                  ),
                  children: (
                    <div className="space-y-4 pt-2">
                      <div className="flex flex-wrap justify-between items-center gap-3">
                        <p className="text-xs text-gray-500 max-w-xl">
                          Kelola seluruh daftar menu, harga dasar, harga promo (harga coret), foto produk, dan kuota stok harian.
                          Perubahan harga langsung berlaku otomatis di Kiosk &amp; Kasir.
                        </p>
                        <Button
                          type="primary"
                          icon={<PlusOutlined />}
                          onClick={() => {
                            setEditingProduct(null);
                            setProdModalOpen(true);
                          }}
                          style={{ background: "var(--tenant-primary)" }}
                          className="font-bold rounded-xl"
                        >
                          Tambah Menu Baru
                        </Button>
                      </div>

                      <Table
                        dataSource={products}
                        columns={productColumns}
                        rowKey="id"
                        loading={loadingMenu}
                        pagination={{ pageSize: 15 }}
                        size="middle"
                      />
                    </div>
                  ),
                },
                {
                  key: "categories",
                  label: (
                    <span className="font-bold text-sm flex items-center gap-2">
                      📂 Kategori Menu ({categories.length})
                    </span>
                  ),
                  children: (
                    <div className="space-y-4 pt-2">
                      <div className="flex flex-wrap justify-between items-center gap-3">
                        <p className="text-xs text-gray-500 max-w-xl">
                          Atur pengelompokan kategori menu dan urutan tampilnya di layar Kiosk serta Kasir POS.
                        </p>
                        <Button
                          type="primary"
                          icon={<PlusOutlined />}
                          onClick={() => {
                            setEditingCat(null);
                            setCatModalOpen(true);
                          }}
                          style={{ background: "var(--tenant-primary)" }}
                          className="font-bold rounded-xl"
                        >
                          Tambah Kategori
                        </Button>
                      </div>

                      <Table
                        dataSource={categories}
                        columns={categoryColumns}
                        rowKey="id"
                        loading={loadingMenu}
                        pagination={false}
                        size="middle"
                      />
                    </div>
                  ),
                },
                {
                  key: "outlet",
                  label: (
                    <span className="font-bold text-sm flex items-center gap-2">
                      ⚙️ Branding, QRIS &amp; Pajak Outlet
                    </span>
                  ),
                  children: (
                    <div className="space-y-6 pt-2">
                      {/* ── Upload Logo & QRIS Statis ── */}
                      <div className="p-5 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                          <div>
                            <h4 className="font-extrabold text-base text-slate-900">🖼️ Aset Visual &amp; Pembayaran QRIS</h4>
                            <p className="text-xs text-slate-500 mt-0.5">
                              Unggah logo outlet dan gambar barcode QRIS statis toko. Gambar otomatis dioptimasi ke format WebP.
                            </p>
                          </div>
                          <Button
                            type="primary"
                            loading={savingBranding}
                            onClick={handleSaveOutletAssets}
                            style={{ background: "var(--tenant-primary)" }}
                            className="font-bold rounded-xl"
                          >
                            💾 Simpan Aset Outlet
                          </Button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div>
                            <label className="block text-xs font-bold text-slate-700 mb-2">
                              Logo Outlet / Brand (Tampil di Kiosk, Kasir &amp; Struk)
                            </label>
                            <ImageUploadField
                              tenantId={tenant.id}
                              folder="logos"
                              value={outletLogoUrl}
                              onChange={setOutletLogoUrl}
                              placeholder="https://contoh.com/logo.webp"
                              helperText="Rekomendasi persegi 1:1 (PNG transparan / JPG / WebP)"
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-bold text-slate-700 mb-2">
                              Barcode QRIS Statis (Tampil di layar Kiosk &amp; Kasir)
                            </label>
                            <ImageUploadField
                              tenantId={tenant.id}
                              folder="qris"
                              value={outletQrisUrl}
                              onChange={setOutletQrisUrl}
                              placeholder="https://contoh.com/qris.webp"
                              helperText="Upload foto/screenshot barcode QRIS toko (resolusi tajam 1080px)"
                            />
                          </div>
                        </div>
                      </div>

                      {/* ── Pengaturan Pajak PB1, Service Charge, Biaya Takeaway & Struk ── */}
                      <div className="p-5 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                          <div>
                            <h4 className="font-extrabold text-base text-slate-900">
                              💰 Pengaturan Pajak (PB1), Service Charge, Biaya Takeaway &amp; Struk
                            </h4>
                            <p className="text-xs text-slate-500 mt-0.5">
                              Atur persentase pajak restoran (PB1/PPN), biaya layanan, biaya bungkus takeaway, dan teks struk kasir.
                            </p>
                          </div>
                          <Button
                            type="primary"
                            loading={savingFinance}
                            onClick={handleSaveFinanceAndReceipt}
                            style={{ background: "var(--tenant-primary)" }}
                            className="font-bold rounded-xl"
                          >
                            💾 Simpan Pajak &amp; Struk
                          </Button>
                        </div>

                        <Form form={financeForm} layout="vertical">
                          <Row gutter={16}>
                            <Col xs={24} md={8}>
                              <Form.Item
                                name="tax_percentage"
                                label="Pajak Restoran PB1 / PPN (%)"
                                help="Isi 0 jika harga menu sudah termasuk pajak / tanpa pajak."
                                rules={[{ required: true, message: "Wajib diisi" }]}
                              >
                                <InputNumber min={0} max={100} className="w-full" addonAfter="%" />
                              </Form.Item>
                            </Col>
                            <Col xs={24} md={8}>
                              <Form.Item
                                name="service_charge_percentage"
                                label="Service Charge / Layanan (%)"
                                help="Isi 0 jika tidak mengenakan biaya layanan."
                                rules={[{ required: true, message: "Wajib diisi" }]}
                              >
                                <InputNumber min={0} max={100} className="w-full" addonAfter="%" />
                              </Form.Item>
                            </Col>
                            <Col xs={24} md={8}>
                              <Form.Item
                                name="takeaway_fee"
                                label="Biaya Bungkus / Takeaway (Rp)"
                                help="Biaya tambahan otomatis khusus pesanan Bawa Pulang."
                                rules={[{ required: true, message: "Wajib diisi" }]}
                              >
                                <InputNumber
                                  min={0}
                                  step={500}
                                  className="w-full"
                                  formatter={(val) => `${val}`.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}
                                />
                              </Form.Item>
                            </Col>
                          </Row>

                          <Row gutter={16} className="mt-2">
                            <Col xs={24} md={6}>
                              <Form.Item name="paper_size" label="Ukuran Kertas Printer Thermal">
                                <Select>
                                  <Select.Option value="58mm">58mm (Standar Portable)</Select.Option>
                                  <Select.Option value="80mm">80mm (Lebar Kasir)</Select.Option>
                                </Select>
                              </Form.Item>
                            </Col>
                            <Col xs={24} md={9}>
                              <Form.Item name="header_text" label="Teks Header Struk (Alamat / Telp)">
                                <Input placeholder="Jl. Sudirman No. 10, Jakarta" />
                              </Form.Item>
                            </Col>
                            <Col xs={24} md={9}>
                              <Form.Item name="footer_text" label="Teks Footer Struk (Ucapan / WiFi)">
                                <Input placeholder="Terima kasih! WiFi: KopiEnak123" />
                              </Form.Item>
                            </Col>
                          </Row>
                        </Form>
                      </div>

                      {/* ── Ringkasan Konfigurasi Inti (Dikelola Super Admin) ── */}
                      <div className="p-4 bg-gray-50 rounded-2xl border space-y-2 text-xs">
                        <div className="flex items-center justify-between">
                          <h4 className="font-bold text-sm text-gray-800">Arsitektur Alur Bisnis Outlet</h4>
                          <Tag color="purple">Dikelola oleh Platform Super Admin</Tag>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
                          <div className="flex justify-between sm:block py-1 border-b sm:border-b-0">
                            <span className="text-gray-500 block">Mode Operasional:</span>
                            <span className="font-bold text-gray-900">
                              {tenant.business_logic?.pos_only ? "POS-Only (Kasir Langsung)" : "Full Mode (Kiosk + Kasir + Dapur + Runner)"}
                            </span>
                          </div>
                          <div className="flex justify-between sm:block py-1 border-b sm:border-b-0">
                            <span className="text-gray-500 block">Skema Pembayaran:</span>
                            <span className="font-bold uppercase text-gray-900">
                              {tenant.business_logic?.payment_timing === "postpaid" ? "Pay Later" : "Bayar di Depan (Prepaid)"}
                            </span>
                          </div>
                          <div className="flex justify-between sm:block py-1">
                            <span className="text-gray-500 block">Mode Penomoran:</span>
                            <span className="font-bold uppercase text-gray-900">
                              {tenant.business_logic?.numbering === "table" ? "Nomor Meja" : "Nomor Antrian"}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ),
                },
              ]}
            />
          </Card>
        </main>

        {/* ── Modal Tambah Staf ── */}
        <Modal
          title={<span className="font-bold text-base">＋ Buat Akun Staf Outlet Baru</span>}
          open={staffModalOpen}
          onCancel={() => setStaffModalOpen(false)}
          onOk={handleCreateStaff}
          confirmLoading={staffSubmitting}
          okText="Simpan Akun"
          cancelText="Batal"
        >
          <Form form={staffForm} layout="vertical" className="pt-2">
            <Form.Item name="fullName" label="Nama Lengkap Staf" rules={[{ required: true, message: "Wajib diisi" }]}>
              <Input placeholder="Contoh: Budi Kasir" />
            </Form.Item>

            <Form.Item name="role" label="Role / Peran Staf" rules={[{ required: true, message: "Pilih peran staf" }]}>
              <Select placeholder="Pilih Role">
                <Select.Option value="CASHIER">Kasir (CASHIER)</Select.Option>
                {!tenant.business_logic?.pos_only && (
                  <>
                    <Select.Option value="KITCHEN">Dapur (KITCHEN)</Select.Option>
                    <Select.Option value="RUNNER">Runner / Pelayan (RUNNER)</Select.Option>
                  </>
                )}
              </Select>
            </Form.Item>

            <Form.Item name="email" label="Email Login" rules={[{ required: true, type: "email", message: "Email valid wajib diisi" }]}>
              <Input placeholder="kasir.outlet@pesanin.id" />
            </Form.Item>

            <Form.Item name="password" label="Password Awal" rules={[{ required: true, min: 8, message: "Password minimal 8 karakter" }]}>
              <Input.Password placeholder="Minimal 8 karakter" />
            </Form.Item>

            <Form.Item
              name="pin"
              label="PIN Login Cepat (Opsional)"
              help="4–6 digit angka. Dipakai staf untuk masuk cepat di tablet outlet saat pergantian shift."
              rules={[{ pattern: /^\d{4,6}$/, message: "PIN harus 4–6 digit angka" }]}
            >
              <Input.Password inputMode="numeric" maxLength={6} placeholder="Contoh: 482916" />
            </Form.Item>
          </Form>
        </Modal>

        {/* ── Modal Atur PIN Staf ── */}
        <Modal
          title={<span className="font-bold text-base">🔑 PIN Login Cepat — {pinModal.staff?.full_name || "Staf"}</span>}
          open={pinModal.open}
          onCancel={() => setPinModal({ open: false, staff: null })}
          footer={[
            pinModal.staff?.has_pin ? (
              <Popconfirm
                key="clear"
                title="Hapus PIN staf ini?"
                description="Staf hanya bisa login dengan email & password."
                onConfirm={() => handleSavePin(true)}
                okText="Ya, Hapus"
                cancelText="Batal"
                okButtonProps={{ danger: true }}
              >
                <Button danger disabled={pinSubmitting}>Hapus PIN</Button>
              </Popconfirm>
            ) : null,
            <Button key="cancel" onClick={() => setPinModal({ open: false, staff: null })}>Batal</Button>,
            <Button key="save" type="primary" loading={pinSubmitting} onClick={() => handleSavePin(false)}>
              Simpan PIN
            </Button>,
          ]}
        >
          <Form form={pinForm} layout="vertical" className="pt-2">
            <Form.Item
              name="pin"
              label="PIN Baru (4–6 digit angka)"
              help="Setelah 5x salah, PIN staf terkunci 5 menit. Menyimpan PIN baru membuka kunci."
              rules={[
                { required: true, message: "PIN wajib diisi" },
                { pattern: /^\d{4,6}$/, message: "PIN harus 4–6 digit angka" },
              ]}
            >
              <Input.Password inputMode="numeric" maxLength={6} placeholder="Contoh: 482916" autoComplete="off" />
            </Form.Item>
          </Form>
        </Modal>

        {/* ── Modal Tambah / Edit Kategori ── */}
        <Modal
          title={<span className="font-bold text-base">{editingCat ? "✏️ Edit Kategori Menu" : "＋ Tambah Kategori Menu"}</span>}
          open={catModalOpen}
          onCancel={() => {
            setCatModalOpen(false);
            setEditingCat(null);
          }}
          onOk={handleSaveCategory}
          confirmLoading={catSubmitting}
          okText="Simpan Kategori"
          cancelText="Batal"
        >
          <Form form={catForm} layout="vertical" className="pt-2">
            <Form.Item name="name" label="Nama Kategori" rules={[{ required: true, message: "Nama kategori wajib diisi" }]}>
              <Input placeholder="Contoh: Kopi Signature, Makanan Berat, Camilan" />
            </Form.Item>

            <Form.Item name="image_url" label="Gambar / Ikon Kategori (Opsional)">
              <ImageUploadField
                tenantId={tenant.id}
                folder="categories"
                placeholder="https://contoh.com/kategori.webp"
                compact
              />
            </Form.Item>

            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="sort_order" label="Urutan Tampil">
                  <InputNumber min={0} className="w-full" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="is_active" label="Status Kategori" valuePropName="checked">
                  <Switch checkedChildren="Aktif" unCheckedChildren="Nonaktif" />
                </Form.Item>
              </Col>
            </Row>
          </Form>
        </Modal>

        {/* ── Modal Tambah / Edit Menu Lengkap ── */}
        <Modal
          title={<span className="font-bold text-base">{editingProduct ? `✏️ Edit Menu — ${editingProduct.name}` : "＋ Tambah Menu Baru"}</span>}
          open={prodModalOpen}
          onCancel={() => {
            setProdModalOpen(false);
            setEditingProduct(null);
          }}
          onOk={handleSaveProduct}
          confirmLoading={productSubmitting}
          okText="Simpan Menu"
          cancelText="Batal"
          width={600}
        >
          <Form form={productForm} layout="vertical" className="pt-2" requiredMark="optional">
            <Row gutter={12}>
              <Col xs={24} sm={14}>
                <Form.Item name="name" label="Nama Menu" rules={[{ required: true, message: "Nama menu wajib diisi" }]}>
                  <Input placeholder="Contoh: Es Kopi Susu Gula Aren" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={10}>
                <Form.Item name="category_id" label="Kategori Menu">
                  <Select placeholder="Pilih kategori" allowClear>
                    {categories.map((c) => (
                      <Select.Option key={c.id} value={c.id}>
                        {c.name}
                      </Select.Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={12}>
              <Col xs={24} sm={8}>
                <Form.Item name="base_price" label="Harga Normal Dasar (Rp)" rules={[{ required: true, message: "Wajib diisi" }]}>
                  <InputNumber
                    className="w-full"
                    min={0}
                    step={1000}
                    formatter={(val) => `${val}`.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} sm={8}>
                <Form.Item
                  name="discount_price"
                  label="Harga Promo (Rp)"
                  extra="Kosongkan bila tidak promo"
                >
                  <InputNumber
                    className="w-full"
                    min={0}
                    step={1000}
                    placeholder="Opsional"
                    formatter={(val) => (val ? `${val}`.replace(/\B(?=(\d{3})+(?!\d))/g, ".") : "")}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} sm={8}>
                <Form.Item
                  name="stock_count"
                  label="Kuota Stok Harian"
                  extra="Kosong = Tanpa batas (∞)"
                >
                  <InputNumber className="w-full" min={0} placeholder="∞ Tanpa Batas" />
                </Form.Item>
              </Col>
            </Row>

            <Form.Item name="description" label="Deskripsi Menu (Opsional)">
              <Input.TextArea rows={2} placeholder="Penjelasan singkat komposisi atau rasa menu..." />
            </Form.Item>

            <Form.Item name="image_url" label="Foto Menu">
              <ImageUploadField
                tenantId={tenant.id}
                folder="products"
                placeholder="https://contoh.com/produk.webp"
                helperText="Upload foto menu (otomatis dikompres ke WebP) atau tempel link URL"
                compact
              />
            </Form.Item>

            <Row gutter={12}>
              <Col xs={12} sm={6}>
                <Form.Item name="sort_order" label="Urutan">
                  <InputNumber min={0} className="w-full" />
                </Form.Item>
              </Col>
              <Col xs={12} sm={6}>
                <Form.Item name="labels" label="Label Tag">
                  <Input placeholder="best_seller, baru" />
                </Form.Item>
              </Col>
              <Col xs={12} sm={6}>
                <Form.Item name="is_available" label="Status Stok" valuePropName="checked">
                  <Switch checkedChildren="Tersedia" unCheckedChildren="Habis" />
                </Form.Item>
              </Col>
              <Col xs={12} sm={6}>
                <Form.Item name="is_featured" label="Menu Unggulan" valuePropName="checked">
                  <Switch checkedChildren="⭐ Unggulan" unCheckedChildren="Biasa" />
                </Form.Item>
              </Col>
            </Row>
          </Form>
        </Modal>
      </div>
    </TenantRoleGuard>
  );
}
