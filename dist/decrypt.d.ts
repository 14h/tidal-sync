export declare function decryptSecurityToken(securityToken: string): {
    key: Buffer;
    nonce: Buffer;
};
export declare function decryptFile(filePath: string, key: Buffer, nonce: Buffer): Promise<void>;
