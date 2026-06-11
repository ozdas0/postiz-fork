import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

/**
 * EOMA entitlement bridge (EOMA #1013).
 *
 * This Postiz fork shares EOMA's Supabase Postgres (Postiz lives in the `postiz`
 * schema; EOMA's app data is in `public`). EOMA owns subscription state — a brand
 * can churn (cancel / payment-fail / trial-expire), at which point its scheduled
 * social posts must STOP publishing. Postiz has no native concept of EOMA's
 * subscription, so the publish workflow asks EOMA, via the SECURITY DEFINER
 * function `public.postiz_org_is_active(org_id)`, whether the org's brand is
 * still active before posting.
 *
 * FAIL-OPEN: any error (DB blip, missing function, etc.) resolves to `true`
 * (allow publish). A fail-closed bridge would let a transient fault silently
 * halt EVERY brand's scheduled posts — far worse than a churned brand's post
 * slipping through (which is itself bounded: EOMA flips the brand lifecycle on
 * churn independently). The EOMA function is ALSO fail-open internally; this is
 * the second layer of the same posture.
 */
@Injectable()
export class EomaEntitlementService {
  private readonly _logger = new Logger(EomaEntitlementService.name);

  constructor(private readonly _prisma: PrismaService) {}

  /**
   * Is the EOMA brand behind this Postiz org still entitled to publish?
   * Returns true (allow) on any error or unresolvable org — fail-open.
   */
  async isOrgActive(organizationId: string): Promise<boolean> {
    if (!organizationId) {
      return true;
    }
    try {
      const rows = await this._prisma.$queryRaw<Array<{ active: boolean }>>`
        SELECT public.postiz_org_is_active(${organizationId}) AS active
      `;
      const active = rows?.[0]?.active;
      // Defensive: treat only an explicit `false` as "blocked". null/undefined
      // (shouldn't happen — the fn always returns a boolean) → fail-open.
      return active === false ? false : true;
    } catch (err) {
      this._logger.warn(
        `EOMA entitlement check failed for org ${organizationId}, allowing publish (fail-open): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return true;
    }
  }
}
