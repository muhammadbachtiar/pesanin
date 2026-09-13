"use client";

import { useEffect, useState, useCallback } from "react";
import { Table, Tag, Button, Modal, Form, Input, Select, Switch, InputNumber, Tabs, Popconfirm, message, Card } from "antd";
import { getTenantBySlug } from "@/services/tenantService";
import { getAllProductsByTenant, updateProduct, toggleProductAvailability } from "@/services/productService";
import { getStaffByTenant, createStaffAccount, toggleStaffActive, deleteStaffAccount, ROLE_LABEL, ROLE_COLOR } from "@/services/staffService";
import { TenantRoleGuard } from "@/components/auth/TenantRoleGuard";
import { supabase } from "@/lib/supabase";
import type { Tenant, Product, Profile, UserRole } from "@/types";

export default function TenantAdminPage({ params }: { params: Promise<{ tenant_slug: string }> }) {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [staffList, setStaffList] = useState<Profile[]>([]);
  const [loadingStaff, setLoadingStaff] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [activeTab, setActiveTab] = useState("staff");

  // Staff Modal
  const [staffModalOpen, setStaffModalOpen] = useState(false);
  const [staffSubmitting, setStaffSubmitting] = useState(false);
  const [staffForm] = Form.useForm();

  // Product Edit Promo & Stock Modal
  const [editProductModal, setEditProductModal] = useState<{ open: boolean; product: Product | null }>({
    open: false,
    product: null,
  });
  const [productForm] = Form.useForm();
  const [productSubmitting, setProductSubmitting] = useState(false);

  const loadData = useCallback(async (tenantId: string) => {
    setLoadingStaff(true);
    setLoadingProducts(true);
    try {
      const [staffs, prods] = await Promise.all([
        getStaffByTenant(tenantId),
        getAllProductsByTenant(tenantId),
      ]);
      setStaffList(staffs);
      setProducts(prods);
    } catch (err) {
      console.error("Error loading admin data:", err);
      message.error("Gagal memuat data outlet");
    } finally {
      setLoadingStaff(false);
      setLoadingProducts(false);
    }
  }, []);

  useEffect(() => {
    async function init() {
      const { tenant_slug } = await params;
      const t = await getTenantBySlug(tenant_slug);
      if (!t) return;
      setTenant(t);
      await loadData(t.id);
    }
    init();
  }, [params, loadData]);

  // ── Handler Tambah Staf ──
  const handleCreateStaff = async () => {
    try {
      const values = await staffForm.validateFields();
      if (!tenant) return;
      setStaffSubmitting(true);

      const res = await createStaffAccount({
        fullName: values.fullName,
        role: values.role as UserRole,
        email: values.email,
        password: values.password,
        tenantId: tenant.id,
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
      setStaffSubmitting(false);
    }
  };

  // ── Handler Toggle Staf Aktif/Nonaktif ──
  const handleToggleStaff = async (profileId: string, currentActive: boolean) => {
    const ok = await toggleStaffActive(profileId, !currentActive);
    if (ok) {
      message.success(`Status staf berhasil ${!currentActive ? "diaktifkan" : "dinonaktifkan"}`);
      if (tenant) loadData(tenant.id);
    } else {
      message.error("Gagal memperbarui status akun staf");
    }
  };

  // ── Handler Hapus Staf Permanen ──
  const handleDeleteStaff = async (profileId: string) => {
    const ok = await deleteStaffAccount(profileId);
    if (ok) {
      message.success("Akun staf berhasil dihapus permanen");
      if (tenant) loadData(tenant.id);
    } else {
      message.error("Gagal menghapus akun staf");
    }
  };

  // ── Handler Edit Promo & Stok Menu ──
  const handleSaveProductPromo = async () => {
    try {
      const values = await productForm.validateFields();
      if (!editProductModal.product) return;
      setProductSubmitting(true);

      const discountPrice = values.discount_price ? Number(values.discount_price) : null;
      const stockCount = values.stock_count !== undefined && values.stock_count !== null ? Number(values.stock_count) : null;

      const res = await updateProduct(editProductModal.product.id, {
        base_price: Number(values.base_price),
        discount_price: discountPrice,
        stock_count: stockCount,
        is_available: stockCount !== null && stockCount <= 0 ? false : editProductModal.product.is_available,
      });

      if (res.success) {
        message.success("Pengaturan harga promo & stok berhasil disimpan!");
        setEditProductModal({ open: false, product: null });
        if (tenant) loadData(tenant.id);
      } else {
        message.error(res.error || "Gagal memperbarui produk. Pastikan kolom database 'discount_price' sudah dibuat.");
      }
    } catch (err) {
      console.error("handleSaveProductPromo error:", err);
    } finally {
      setProductSubmitting(false);
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
      title: "Aksi",
      key: "actions",
      render: (_: unknown, record: Profile) => (
        <div className="flex items-center gap-2">
          <Button
            size="small"
            type={record.is_active ? "default" : "primary"}
            onClick={() => handleToggleStaff(record.id, record.is_active)}
            style={!record.is_active ? { background: "#059669" } : {}}
          >
            {record.is_active ? "Nonaktifkan" : "Aktifkan"}
          </Button>

          <Popconfirm
            title="Hapus akun staf ini permanen?"
            description="Tindakan ini akan menghapus akses login akun ini secara permanen."
            onConfirm={() => handleDeleteStaff(record.id)}
            okText="Ya, Hapus"
            cancelText="Batal"
            okButtonProps={{ danger: true }}
          >
            <Button size="small" danger>
              Hapus
            </Button>
          </Popconfirm>
        </div>
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
        return (
          <div className="flex items-center gap-3">
            {p.image_urls[0] ? (
              <img src={p.image_urls[0]} alt={p.name} className="w-12 h-12 object-cover rounded-xl border flex-shrink-0" />
            ) : (
              <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center text-xl flex-shrink-0">🍽️</div>
            )}
            <div>
              <div className="font-bold text-sm text-gray-900 flex items-center gap-1.5">
                {p.name}
                {hasPromo && (
                  <span className="text-[10px] font-black bg-rose-500 text-white px-2 py-0.5 rounded-full">
                    🔥 -{discountPct}%
                  </span>
                )}
              </div>
              <div className="text-xs text-gray-400 mt-0.5 line-clamp-1">{p.description || "Tanpa deskripsi"}</div>
            </div>
          </div>
        );
      },
    },
    {
      title: "Harga Dasar",
      dataIndex: "base_price",
      key: "base_price",
      render: (price: number) => <span className="font-semibold text-gray-700">Rp {price.toLocaleString("id-ID")}</span>,
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
          onChange={async (checked) => {
            await toggleProductAvailability(record.id, checked);
            if (tenant) loadData(tenant.id);
          }}
          checkedChildren="Tersedia"
          unCheckedChildren="Habis"
        />
      ),
    },
    {
      title: "Aksi",
      key: "action",
      render: (_: unknown, p: Product) => (
        <Button
          size="small"
          onClick={() => {
            setEditProductModal({ open: true, product: p });
            productForm.setFieldsValue({
              base_price: p.base_price,
              discount_price: p.discount_price || undefined,
              stock_count: p.stock_count !== null ? p.stock_count : undefined,
            });
          }}
        >
          ⚙️ Atur Promo & Stok
        </Button>
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
          className="px-6 py-4 flex items-center justify-between text-white shadow-md"
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

          <div className="flex items-center gap-2">
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
                window.location.href = "/login";
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
                      <div className="flex justify-between items-center">
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
                      🍽️ Katalog Menu, Promo & Stok ({products.length})
                    </span>
                  ),
                  children: (
                    <div className="space-y-4 pt-2">
                      <div className="flex justify-between items-center">
                        <p className="text-xs text-gray-500 max-w-xl">
                          Atur harga promo (harga coret) dan kuota stok menu harian. Menu dengan harga promo otomatis
                          menampilkan badge diskon di Kiosk dan Kasir.
                        </p>
                      </div>

                      <Table
                        dataSource={products}
                        columns={productColumns}
                        rowKey="id"
                        loading={loadingProducts}
                        pagination={{ pageSize: 15 }}
                        size="middle"
                      />
                    </div>
                  ),
                },
                {
                  key: "outlet",
                  label: (
                    <span className="font-bold text-sm flex items-center gap-2">
                      ⚙️ Ringkasan Konfigurasi Outlet
                    </span>
                  ),
                  children: (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                      <div className="p-4 bg-gray-50 rounded-2xl border space-y-2 text-xs">
                        <h4 className="font-bold text-sm text-gray-800">Alur Bisnis & Pemesanan</h4>
                        <div className="flex justify-between py-1 border-b">
                          <span className="text-gray-500">Mode POS Only:</span>
                          <span className="font-bold">{tenant.business_logic?.pos_only ? "Aktif (Standalone POS)" : "Nonaktif (Kafe Resto Normal)"}</span>
                        </div>
                        <div className="flex justify-between py-1 border-b">
                          <span className="text-gray-500">Waktu Pembayaran:</span>
                          <span className="font-bold uppercase">{tenant.business_logic?.payment_timing || "Prepaid"}</span>
                        </div>
                        <div className="flex justify-between py-1">
                          <span className="text-gray-500">Mode Penomoran:</span>
                          <span className="font-bold uppercase">{tenant.business_logic?.numbering || "Queue"}</span>
                        </div>
                      </div>

                      <div className="p-4 bg-gray-50 rounded-2xl border space-y-2 text-xs">
                        <h4 className="font-bold text-sm text-gray-800">Struk & Keuangan</h4>
                        <div className="flex justify-between py-1 border-b">
                          <span className="text-gray-500">Ukuran Kertas Thermal:</span>
                          <span className="font-bold">{tenant.receipt_config?.paper_size || "58mm"}</span>
                        </div>
                        <div className="flex justify-between py-1 border-b">
                          <span className="text-gray-500">Pajak (PPN):</span>
                          <span className="font-bold">{tenant.finance_config?.tax_percentage || 0}%</span>
                        </div>
                        <div className="flex justify-between py-1">
                          <span className="text-gray-500">Service Charge:</span>
                          <span className="font-bold">{tenant.finance_config?.service_charge_percentage || 0}%</span>
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
          </Form>
        </Modal>

        {/* ── Modal Edit Promo & Stok Menu ── */}
        <Modal
          title={<span className="font-bold text-base">⚙️ Pengaturan Promo & Stok Menu</span>}
          open={editProductModal.open}
          onCancel={() => setEditProductModal({ open: false, product: null })}
          onOk={handleSaveProductPromo}
          confirmLoading={productSubmitting}
          okText="Simpan Perubahan"
          cancelText="Batal"
        >
          <Form form={productForm} layout="vertical" className="pt-2">
            <div className="p-3 bg-gray-50 rounded-xl mb-4 text-xs space-y-1">
              <span className="font-bold text-gray-800 block text-sm">{editProductModal.product?.name}</span>
              <span className="text-gray-500">Harga dasar saat ini: Rp {editProductModal.product?.base_price.toLocaleString("id-ID")}</span>
            </div>

            <Form.Item name="base_price" label="Harga Normal Dasar (Rp)" rules={[{ required: true, message: "Wajib diisi" }]}>
              <InputNumber className="w-full" min={0} step={1000} formatter={(val) => `${val}`.replace(/\B(?=(\d{3})+(?!\d))/g, ".")} />
            </Form.Item>

            <Form.Item
              name="discount_price"
              label="Harga Promo / Diskon (Rp)"
              help="Kosongkan jika tidak ada promo. Jika diisi lebih murah dari harga dasar, otomatis menjadi harga jual aktif dengan badge diskon."
            >
              <InputNumber className="w-full" min={0} step={1000} placeholder="Contoh: 20000" formatter={(val) => (val ? `${val}`.replace(/\B(?=(\d{3})+(?!\d))/g, ".") : "")} />
            </Form.Item>

            <Form.Item
              name="stock_count"
              label="Kuota Sisa Stok Harian (Porsi)"
              help="Kosongkan jika stok tanpa batas (unlimited)."
            >
              <InputNumber className="w-full" min={0} placeholder="Kosong = Tanpa Batas" />
            </Form.Item>
          </Form>
        </Modal>
      </div>
    </TenantRoleGuard>
  );
}
