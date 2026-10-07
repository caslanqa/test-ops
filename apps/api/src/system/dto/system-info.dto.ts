/** Facts about the running installation, shown on the app's Help & support page. */
export class SystemInfoDto {
  /**
   * Release version of the running image, or "dev" for a local build.
   * @example "0.3.0"
   */
  version!: string;

  /**
   * Version of the REST API, which is also its path prefix.
   * @example "v1"
   */
  apiVersion!: string;
}
