import type { TokenData, DeviceAuth } from "./types.js";
export declare function getDeviceCode(): Promise<DeviceAuth>;
export declare function pollForToken(deviceCode: string, interval: number, expiresIn: number): Promise<TokenData>;
export declare function loadToken(): Promise<TokenData | null>;
export declare function logout(): Promise<void>;
