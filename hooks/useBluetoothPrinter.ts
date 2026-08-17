"use client";

/**
 * useBluetoothPrinter.ts — Hook untuk koneksi & pencetakan via Web Bluetooth API (ESC/POS)
 * 
 * Mendukung printer thermal Bluetooth standar (Zijiang, Panda, VSC, Mini POS, EPSON, dll).
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { generateReceiptEscPos, type EscPosOptions } from "@/lib/escposHelper";
import type { Order, Tenant } from "@/types";

// Common Bluetooth Printer Service & Characteristic UUIDs
const PRINTER_SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb", // Standard ESC/POS Service
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2", // Common Mini Thermal Printer
  "49535343-fe7d-4ae5-8fa9-9fafd205e455", // ISSC / Microchip Transparent UART
  "0000ff00-0000-1000-8000-00805f9b34fb", // Generic POS
  "0000af00-0000-1000-8000-00805f9b34fb", // Android POS
];

export interface BluetoothPrinterState {
  isSupported: boolean;
  isConnected: boolean;
  isConnecting: boolean;
  isPrinting: boolean;
  deviceName: string | null;
  error: string | null;
}

export function useBluetoothPrinter() {
  const [isSupported, setIsSupported] = useState<boolean>(false);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [isPrinting, setIsPrinting] = useState<boolean>(false);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const characteristicRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deviceRef = useRef<any>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && typeof navigator !== "undefined") {
      setIsSupported("bluetooth" in navigator);
    }
  }, []);

  /**
   * Handle auto-cleanup on disconnect
   */
  const handleDisconnected = useCallback(() => {
    setIsConnected(false);
    setDeviceName(null);
    characteristicRef.current = null;
    deviceRef.current = null;
  }, []);

  /**
   * Request Bluetooth device and establish GATT connection
   */
  const connect = useCallback(async (): Promise<boolean> => {
    if (typeof navigator === "undefined" || !("bluetooth" in navigator)) {
      setError("Web Bluetooth API tidak didukung pada browser ini (gunakan Chrome/Edge).");
      return false;
    }

    setIsConnecting(true);
    setError(null);

    try {
      // 1. Request device dialog
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const navBluetooth = (navigator as any).bluetooth;
      const device = await navBluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: PRINTER_SERVICES,
      });

      if (!device || !device.gatt) {
        throw new Error("Perangkat Bluetooth tidak ditemukan atau tidak memiliki GATT.");
      }

      device.addEventListener("gattserverdisconnected", handleDisconnected);
      deviceRef.current = device;

      // 2. Connect to GATT Server
      const server = await device.gatt.connect();

      // 3. Find primary printer service & writable characteristic
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let writeChar: any = null;

      // Try discovering known printer services
      for (const serviceUuid of PRINTER_SERVICES) {
        try {
          const service = await server.getPrimaryService(serviceUuid);
          const characteristics = await service.getCharacteristics();
          for (const char of characteristics) {
            if (char.properties.write || char.properties.writeWithoutResponse) {
              writeChar = char;
              break;
            }
          }
          if (writeChar) break;
        } catch {
          // Continue searching other services
        }
      }

      // If not found in known UUIDs, try generic services
      if (!writeChar) {
        try {
          const services = await server.getPrimaryServices();
          for (const service of services) {
            const characteristics = await service.getCharacteristics();
            for (const char of characteristics) {
              if (char.properties.write || char.properties.writeWithoutResponse) {
                writeChar = char;
                break;
              }
            }
            if (writeChar) break;
          }
        } catch (e) {
          console.warn("Error exploring generic services:", e);
        }
      }

      if (!writeChar) {
        throw new Error("Gagal menemukan channel penulisan data pada printer.");
      }

      characteristicRef.current = writeChar;
      setDeviceName(device.name || "Thermal Printer");
      setIsConnected(true);
      setIsConnecting(false);
      return true;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "Gagal menghubungkan printer Bluetooth";
      if (!errMsg.includes("User cancelled") && !errMsg.includes("User dismissed")) {
        setError(errMsg);
      }
      setIsConnecting(false);
      setIsConnected(false);
      return false;
    }
  }, [handleDisconnected]);

  /**
   * Disconnect from Bluetooth printer
   */
  const disconnect = useCallback(() => {
    if (deviceRef.current && deviceRef.current.gatt && deviceRef.current.gatt.connected) {
      deviceRef.current.gatt.disconnect();
    }
    handleDisconnected();
  }, [handleDisconnected]);

  /**
   * Send raw byte buffer in chunks (MTU safe: 100 bytes per packet)
   */
  const sendRawBytes = useCallback(async (data: Uint8Array): Promise<boolean> => {
    if (!characteristicRef.current) {
      setError("Printer Bluetooth belum terhubung.");
      return false;
    }

    setIsPrinting(true);
    setError(null);

    try {
      const CHUNK_SIZE = 100;
      for (let i = 0; i < data.length; i += CHUNK_SIZE) {
        const chunk = data.slice(i, i + CHUNK_SIZE);
        if (characteristicRef.current.writeValueWithoutResponse) {
          await characteristicRef.current.writeValueWithoutResponse(chunk);
        } else {
          await characteristicRef.current.writeValue(chunk);
        }
        // Small delay to prevent Bluetooth buffer overload
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      setIsPrinting(false);
      return true;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "Gagal mengirim data ke printer Bluetooth";
      setError(errMsg);
      setIsPrinting(false);
      return false;
    }
  }, []);

  /**
   * Print order receipt directly via Bluetooth ESC/POS
   */
  const printBluetoothReceipt = useCallback(
    async (order: Order, tenant: Tenant, options: EscPosOptions = {}): Promise<boolean> => {
      if (!isConnected || !characteristicRef.current) {
        setError("Printer Bluetooth belum terhubung.");
        return false;
      }
      const bytes = generateReceiptEscPos(order, tenant, options);
      return await sendRawBytes(bytes);
    },
    [isConnected, sendRawBytes]
  );

  return {
    isSupported,
    isConnected,
    isConnecting,
    isPrinting,
    deviceName,
    error,
    connect,
    disconnect,
    sendRawBytes,
    printBluetoothReceipt,
  };
}
