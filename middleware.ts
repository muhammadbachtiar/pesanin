import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
    const response = NextResponse.next({ request });

    // Buat server client untuk refresh session cookie
    const sb = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() { return request.cookies.getAll(); },
                setAll(toSet) {
                    toSet.forEach(({ name, value, options }) => {
                        request.cookies.set(name, value);
                        response.cookies.set(name, value, options);
                    });
                },
            },
        }
    );

    // Refresh session agar access token tidak expire
    const { data: { user } } = await sb.auth.getUser();

    const path = request.nextUrl.pathname;

    // Guard halaman super-admin
    if (path.startsWith("/super-admin") && !user) {
        return NextResponse.redirect(new URL("/login", request.url));
    }

    // Guard API admin — return JSON 401
    if (path.startsWith("/api/admin") && !user) {
        return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });
    }

    return response;
}

// PENTING: matcher hanya untuk route yang perlu diproteksi
// Jangan masukkan /login atau auth callback — akan mengganggu flow login
export const config = {
    matcher: [
        "/super-admin/:path*",
        "/api/admin/:path*",
    ],
};
