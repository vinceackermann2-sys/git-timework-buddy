import * as React from 'npm:react@18.3.1';
import { renderAsync } from 'npm:@react-email/components@0.0.22';
import { createClient } from 'npm:@supabase/supabase-js@2.106.2';
import { dispatchEmailQueue } from '../_shared/emailQueue.ts';
import { enqueueEmail } from '../_shared/queuedEmail.ts';
import {
  ContactReceiptEmail,
  ContactSubmissionEmail,
  WaitlistConfirmationEmail,
} from '../_shared/email-templates/contact.tsx';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const cleanLine = (value: unknown, max = 160) =>
  String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

const cleanMessage = (value: unknown) =>
  String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, 5000);

type IssueImage = {
  originalName: string;
  contentType: string;
  bytes: Uint8Array;
};

const issueImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const issueImageLimit = 3;
const issueImageByteLimit = 4 * 1024 * 1024;
const issueImageTotalByteLimit = 8 * 1024 * 1024;

const readIssueImages = (value: unknown): { images?: IssueImage[]; error?: string } => {
  if (!Array.isArray(value) || value.length === 0) return { error: 'At least one image is required.' };
  if (value.length > issueImageLimit) return { error: `You can attach up to ${issueImageLimit} images.` };

  const images: IssueImage[] = [];
  let totalBytes = 0;
  for (const item of value) {
    if (!item || typeof item !== 'object') return { error: 'An attached image is invalid.' };
    const record = item as Record<string, unknown>;
    const dataUrl = String(record.dataUrl ?? '');
    // The MIME type is taken from the data URL, not the browser-provided file
    // name or type. This keeps arbitrary files out of the private image bucket.
    const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(dataUrl);
    if (!match || !issueImageTypes.has(match[1])) return { error: 'Use a PNG, JPG, WebP, or GIF image.' };

    try {
      const base64 = match[2].replace(/\s+/g, '');
      if (base64.length > Math.ceil(issueImageByteLimit * 4 / 3) + 8) {
        return { error: 'Each image must be 4 MB or smaller.' };
      }
      const binary = atob(base64);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      if (bytes.byteLength === 0 || bytes.byteLength > issueImageByteLimit) {
        return { error: 'Each image must be between 1 byte and 4 MB.' };
      }
      totalBytes += bytes.byteLength;
      if (totalBytes > issueImageTotalByteLimit) return { error: 'Keep all attached images under 8 MB total.' };
      images.push({
        originalName: cleanLine(record.name, 120) || `image-${images.length + 1}`,
        contentType: match[1],
        bytes,
      });
    } catch {
      return { error: 'An attached image could not be decoded.' };
    }
  }

  return { images };
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const attempts = new Map<string, number[]>();
const siteUrl = (Deno.env.get('TIMEWARP_SITE_URL') || 'https://timewarpdev.com').replace(/\/+$/, '');
const fromEmail = Deno.env.get('TIMEWARP_EMAIL_FROM') || 'Timewarp <noreply@agents.timewarpdev.com>';
const supportEmail = Deno.env.get('CONTACT_TO_EMAIL') || 'support@timewarpdev.com';
const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const isRateLimited = (request: Request) => {
  const key = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('cf-connecting-ip')
    || 'unknown';
  const now = Date.now();
  const recent = (attempts.get(key) || []).filter((time) => now - time < 10 * 60 * 1000);
  recent.push(now);
  attempts.set(key, recent);
  return recent.length > 5;
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405);
  if (isRateLimited(request)) return jsonResponse({ error: 'Too many messages. Please try again later.' }, 429);

  let input: Record<string, unknown>;
  try {
    input = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request.' }, 400);
  }

  // Quietly accept the honeypot so automated spam does not learn how it was caught.
  if (cleanLine(input.website)) return jsonResponse({ ok: true });

  // The desktop's native feedback form has no image or contact-name fields.
  // Authenticate it separately and take reporter identity from Supabase Auth.
  if (input.kind === 'feedback') {
    if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: 'Report storage is not configured.' }, 503);
    const authorization = request.headers.get('Authorization') || '';
    if (!/^Bearer\s+\S+$/i.test(authorization)) return jsonResponse({ error: 'Sign in to send a report.' }, 401);
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: authData, error: authError } = await admin.auth.getUser(authorization.replace(/^Bearer\s+/i, ''));
    const user = authData?.user;
    if (authError || !user?.id || !user.email) return jsonResponse({ error: 'Sign in to send a report.' }, 401);
    const description = typeof input.description === 'string' ? input.description.trim() : '';
    if (!description || description.length > 5000) return jsonResponse({ error: 'Provide a description of up to 5,000 characters.' }, 400);
    const context = input.environment && typeof input.environment === 'object' && !Array.isArray(input.environment)
      ? input.environment as Record<string, unknown> : {};
    const traceId = `${new Date().toISOString().slice(0, 10).replaceAll('-', '')}_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const { data: ticket, error } = await admin.from('support_tickets').insert({
      category: 'bug',
      title: cleanLine(description.split('\n')[0], 160) || 'App feedback',
      description,
      reporter_name: cleanLine(user.user_metadata?.full_name || user.user_metadata?.name || user.email.split('@')[0], 100),
      reporter_email: user.email,
      user_id: user.id,
      source: 'timewarp_desktop',
      app_version: cleanLine(context.appVersion, 80) || null,
      environment: cleanLine(context.app, 120) || 'desktop',
      platform: cleanLine(context.platform, 120) || null,
      diagnostics: JSON.stringify({
        traceId,
        route: cleanLine(input.route, 2000) || null,
        conversationId: cleanLine(input.conversationId, 160) || null,
        releaseChannel: cleanLine(context.releaseChannel, 80) || null,
      }),
    }).select('id, ticket_number').single();
    if (error || !ticket) {
      console.error('Desktop feedback storage failed:', error?.message || 'No ticket returned.');
      return jsonResponse({ error: 'Your report could not be saved. Try again.' }, 502);
    }
    return jsonResponse({ ok: true, traceId, ticketId: ticket.id, ticketNumber: ticket.ticket_number });
  }

  const requestedKind = cleanLine(input.kind, 20);
  const kind = requestedKind === 'enterprise'
    ? 'enterprise'
    : requestedKind === 'issue'
      ? 'issue'
      : requestedKind === 'waitlist'
        ? 'waitlist'
        : 'general';
  const name = cleanLine(input.name, 100);
  const email = cleanLine(input.email, 254).toLowerCase();
  const company = cleanLine(input.company, 160);
  const teamSize = cleanLine(input.teamSize, 40);
  const topic = cleanLine(input.topic, 80);
  const issueType = cleanLine(input.issueType, 80);
  const title = cleanLine(input.title, 160);
  const message = cleanMessage(input.message);
  const steps = cleanMessage(input.steps);
  const expected = cleanMessage(input.expected);
  const actual = cleanMessage(input.actual);
  const diagnostics = cleanMessage(input.diagnostics);
  const appVersion = cleanLine(input.appVersion, 80);
  const environment = cleanLine(input.environment, 120);
  const platform = cleanLine(input.platform, 120);
  // What the model actually wrote, when the report is about AI-generated output.
  const aiContent = cleanMessage(input.aiContent);
  const issueImageResult = kind === 'issue' ? readIssueImages(input.images) : { images: [] as IssueImage[] };

  if (kind === 'issue' && issueImageResult.error) return jsonResponse({ error: issueImageResult.error }, 400);

  if (kind === 'waitlist') {
    if (!emailPattern.test(email)) return jsonResponse({ error: 'Please provide a valid email address.' }, 400);

    if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: 'Waitlist storage is not configured.' }, 503);

    const product = cleanLine(input.product, 40) || 'mac';
    const source = cleanLine(input.source, 80) || 'website';
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await admin
      .from('product_waitlist')
      .upsert({ email, product, source, updated_at: new Date().toISOString() }, { onConflict: 'product,email' });

    if (error) {
      console.error('Waitlist signup failed:', error.message);
      return jsonResponse({ error: 'Waitlist signup failed.' }, 502);
    }

    try {
      const element = React.createElement(WaitlistConfirmationEmail, { siteUrl });
      await enqueueEmail(admin, {
        to: email,
        from: fromEmail,
        subject: "You're on the Timewarp for Mac waitlist",
        html: await renderAsync(element),
        text: await renderAsync(element, { plainText: true }),
        label: 'mac_waitlist_confirmation',
      });
      await dispatchEmailQueue();
    } catch (mailError) {
      console.error('Waitlist confirmation could not be queued:', mailError);
    }
    return jsonResponse({ ok: true });
  }

  if (
    name.length < 2
    || !emailPattern.test(email)
    || message.length < 10
    || (kind === 'enterprise' && !company)
    || (kind === 'issue' && title.length < 3)
  ) {
    return jsonResponse({ error: 'Please provide a valid name, email, and message.' }, 400);
  }

  // Reports about AI-generated content are labelled apart from ordinary bugs so
  // they can be triaged and reviewed on their own terms.
  const isAiContentReport = kind === 'issue' && (Boolean(aiContent) || issueType === 'AI response');
  const label = kind === 'enterprise'
    ? 'Enterprise enquiry'
    : kind === 'issue'
      ? (isAiContentReport ? 'Timewarp AI content report' : 'Timewarp issue report')
      : (topic || 'Website enquiry');
  const details = ([
    ['Name', name],
    ['Email', email],
    ['Company', company],
    ['Team size', teamSize],
    ['Topic', topic],
    ['Issue type', issueType],
    ['Title', title],
  ] as Array<[string, string]>).filter(([, value]) => value);
  const issueDetails = kind === 'issue'
    ? ([
        ['Reported AI response', aiContent],
        ['Steps to reproduce', steps],
        ['Expected result', expected],
        ['Actual result', actual],
        ['Technical context', diagnostics],
      ] as Array<[string, string]>).filter(([, value]) => value)
    : [];

  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: 'Contact delivery is not configured.' }, 503);
  const admin = createClient(
    supabaseUrl,
    serviceRoleKey,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  let ticketId = '';
  let ticketNumber: string | number | null = null;

  if (kind === 'issue') {
    let userId: string | null = null;
    const authorization = request.headers.get('Authorization') || '';
    if (/^Bearer\s+/i.test(authorization)) {
      const { data: authData } = await admin.auth.getUser(authorization.replace(/^Bearer\s+/i, ''));
      userId = authData.user?.id ?? null;
    }

    const { data: ticket, error: ticketError } = await admin
      .from('support_tickets')
      .insert({
        category: isAiContentReport ? 'ai_response' : 'bug',
        title,
        description: message,
        reporter_name: name,
        reporter_email: email,
        user_id: userId,
        ai_content: aiContent || null,
        diagnostics: diagnostics || null,
        app_version: appVersion || null,
        environment: environment || null,
        platform: platform || null,
        source: 'timewarp_app',
      })
      .select('id, ticket_number')
      .single();

    if (ticketError || !ticket) {
      console.error('Support ticket creation failed:', ticketError?.message || 'No ticket returned.');
      return jsonResponse({ error: 'Ticket creation failed.' }, 502);
    }

    ticketId = String(ticket.id);
    ticketNumber = ticket.ticket_number as string | number;
    const uploadedPaths: string[] = [];
    const attachmentRecords: Array<Record<string, unknown>> = [];
    for (const [index, image] of (issueImageResult.images || []).entries()) {
      const safeName = image.originalName
        .normalize('NFKD')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(-90) || `image-${index + 1}`;
      const path = `${ticketId}/${String(index + 1).padStart(2, '0')}-${safeName}`;
      const { error: uploadError } = await admin.storage
        .from('support-ticket-images')
        .upload(path, image.bytes, { contentType: image.contentType, upsert: false });

      if (uploadError) {
        console.error('Support ticket image upload failed:', uploadError.message);
        if (uploadedPaths.length > 0) await admin.storage.from('support-ticket-images').remove(uploadedPaths);
        await admin.from('support_tickets').delete().eq('id', ticketId);
        return jsonResponse({ error: 'Image upload failed.' }, 502);
      }

      uploadedPaths.push(path);
      attachmentRecords.push({
        path,
        name: image.originalName,
        content_type: image.contentType,
        size_bytes: image.bytes.byteLength,
      });
    }

    const { error: attachmentError } = await admin
      .from('support_tickets')
      .update({ attachments: attachmentRecords })
      .eq('id', ticketId);
    if (attachmentError) {
      console.error('Support ticket attachment metadata failed:', attachmentError.message);
      await admin.storage.from('support-ticket-images').remove(uploadedPaths);
      await admin.from('support_tickets').delete().eq('id', ticketId);
      return jsonResponse({ error: 'Ticket attachment storage failed.' }, 502);
    }

    details.push(['Supabase ticket', `TW-${String(ticketNumber).padStart(6, '0')}`]);
    issueDetails.push(['Images in private storage', uploadedPaths.join('\n')]);
  }

  const heading = title || company || name;
  const submission = React.createElement(ContactSubmissionEmail, {
    siteUrl,
    label,
    heading,
    details,
    issueDetails,
    message,
  });
  const receipt = React.createElement(ContactReceiptEmail, { siteUrl, name, kind });

  try {
    await enqueueEmail(admin, {
      to: supportEmail,
      from: fromEmail,
      replyTo: email,
      subject: `${label} - ${heading}`,
      html: await renderAsync(submission),
      text: await renderAsync(submission, { plainText: true }),
      label: `contact_${kind}`,
    });
    await enqueueEmail(admin, {
      to: email,
      from: fromEmail,
      replyTo: supportEmail,
      subject: 'We received your Timewarp message',
      html: await renderAsync(receipt),
      text: await renderAsync(receipt, { plainText: true }),
      label: `contact_${kind}_receipt`,
    });
    await dispatchEmailQueue();
  } catch (deliveryError) {
    console.error('Contact delivery could not be queued:', deliveryError);
    // The Supabase ticket is the source of truth. A temporary email problem
    // must not make the user resubmit and create a duplicate ticket.
    if (kind === 'issue' && ticketId) {
      return jsonResponse({ ok: true, ticketId, ticketNumber, notificationQueued: false });
    }
    return jsonResponse({ error: 'Message delivery failed.' }, 502);
  }

  return jsonResponse({ ok: true, ...(ticketId ? { ticketId, ticketNumber, notificationQueued: true } : {}) });
});
