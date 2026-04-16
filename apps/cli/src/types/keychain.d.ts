declare module "keychain" {
  interface KeychainOptions {
    account: string;
    service: string;
    type?: string;
  }

  interface SetPasswordOptions extends KeychainOptions {
    password: string;
  }

  interface KeychainAccess {
    getPassword(opts: KeychainOptions, cb: (err: Error | null, password?: string) => void): void;
    setPassword(opts: SetPasswordOptions, cb: (err: Error | null) => void): void;
    deletePassword(opts: KeychainOptions, cb: (err: Error | null) => void): void;
  }

  const keychain: KeychainAccess;
  export default keychain;
}
