import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";
export async function POST(req) {
  await destroySession();
  return NextResponse.redirect(new URL("/", req.url), 303);
}
