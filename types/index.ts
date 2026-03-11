export type UserRole = "SUPER_ADMIN" | "OWNER" | "CASHIER" | "KITCHEN";
export type PaymentTiming = "prepaid" | "postpaid";
export type PaymentMode = "gateway" | "manual";
export type NamberingType = "queue" | "table";
export type TableStatus = "available" | "occupied" | "broken";
export type OrderStatus = "pending" | "cooking" | "ready" | "completed" | "cancelled";
export type PaymentStatus = "unpaid" | "paid" | "refunded";
export type VerificationStatus = "unverified" | "verified" | "rejected";
export type OrderType = "dine_in" | "takeaway";
export type PaymentMethodType = "gateway" | "qris_static" | "bank_transfer" | "cash";

export interface ManualPaymentChannel {
    id: string;
    type: "qris_static" | "bank_transfer" | "cash";
    label: string;
    image_url?: string;
    bank_name?: string;
    account_number?: string;
    account_name?: string;
    instructions?: string;
}

export interface VisualConfig {
    primary_color: string;
    secondary_color: string;
}

export interface BusinessLogic {
    payment_timing: PaymentTiming;
    payment_mode: PaymentMode;
    numbering: NamberingType;
    require_cashier_verification: boolean;
}

export interface FinanceConfig {
    tax_percentage: number;
    service_charge_percentage: number;
    takeaway_fee: number;
}

export interface ReceiptConfig {
    header_text: string;
    footer_text: string;
    show_logo: boolean;
}

export interface Tenant {
    id: string;
    name: string;
    slug: string;
    subtitle: string | null;
    description: string | null;
    logo_url: string | null;
    visual_config: VisualConfig;
    business_logic: BusinessLogic;
    finance_config: FinanceConfig;
    payment_gateway_config: Record<string, string>;
    manual_payment_channels: ManualPaymentChannel[];
    receipt_config: ReceiptConfig;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

export interface Profile {
    id: string;
    user_id: string;
    tenant_id: string | null;
    full_name: string | null;
    role: UserRole;
    is_active: boolean;
}

export interface TableRecord {
    id: string;
    tenant_id: string;
    table_number: string;
    display_name: string | null;
    current_token: string;
    status: TableStatus;
    last_token_reset: string;
}

export interface Category {
    id: string;
    tenant_id: string;
    name: string;
    description: string | null;
    image_url: string | null;
    sort_order: number;
    is_active: boolean;
}

export interface SelectedVariant {
    group: string;
    option: string;
    additional_price: number;
}

export interface ProductVariantOption {
    id: string;
    group_id: string;
    name: string;
    additional_price: number;
    is_available: boolean;
    sort_order: number;
}

export interface ProductVariantGroup {
    id: string;
    product_id: string;
    name: string;
    is_required: boolean;
    max_selections: number;
    sort_order: number;
    options: ProductVariantOption[];
}

export interface Product {
    id: string;
    tenant_id: string;
    category_id: string | null;
    name: string;
    description: string | null;
    base_price: number;
    image_urls: string[];
    is_available: boolean;
    stock_count: number | null;
    labels: string[];
    sort_order: number;
    is_featured: boolean;
    variant_groups?: ProductVariantGroup[];
}

export interface OrderItem {
    id: string;
    order_id: string;
    product_id: string | null;
    product_name_snapshot: string;
    base_price_snapshot: number;
    selected_variants: SelectedVariant[];
    quantity: number;
    unit_price: number;
    subtotal: number;
    notes: string | null;
    created_at: string;
}

export interface Order {
    id: string;
    tenant_id: string;
    queue_number: string;
    table_number: string | null;
    table_id: string | null;
    order_type: OrderType;
    order_status: OrderStatus;
    payment_status: PaymentStatus;
    verification_status: VerificationStatus;
    subtotal: number;
    tax_amount: number;
    service_charge_amount: number;
    takeaway_fee_amount: number;
    total_amount: number;
    payment_method: PaymentMethodType | null;
    selected_manual_channel_id: string | null;
    gateway_transaction_id: string | null;
    customer_notes: string | null;
    verified_by: string | null;
    verified_at: string | null;
    void_reason: string | null;
    voided_by: string | null;
    voided_at: string | null;
    created_by_cashier: boolean;
    cashier_profile_id: string | null;
    finance_snapshot: FinanceConfig;
    created_at: string;
    updated_at: string;
    items?: OrderItem[];
}

export interface CartItem {
    product: Product;
    quantity: number;
    selected_variants: SelectedVariant[];
    notes: string;
    unit_price: number;
}
