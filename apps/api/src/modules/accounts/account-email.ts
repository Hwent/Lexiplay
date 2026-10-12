const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

export function accountEmail(purpose: 'reset' | 'verify', actionUrl: string) {
  const verification = purpose === 'verify';
  const heading = verification ? 'Verify your email address' : 'Reset your password';
  const request = verification
    ? 'Please confirm that this email address belongs to you by selecting the button below.'
    : 'We received a request to reset the password for your LexiPlay account. Select the button below to choose a new password.';
  const expiry = verification ? '24 hours' : '30 minutes';
  const optional = verification ? 'Email verification is optional. You may continue using LexiPlay without completing this step.' : 'Your existing password remains unchanged until you complete the reset.';
  const url = escapeHtml(actionUrl);
  return {
    subject: verification ? 'LexiPlay — Email address verification' : 'LexiPlay — Password reset request',
    text: `Hello,\n\n${request}\n\n${heading}:\n${actionUrl}\n\nThis link expires in ${expiry} and can be used only once.\n${optional}\n\nIf you did not request this email, no action is required. You can safely ignore it. Do not share this link with anyone.\n\nRegards,\nThe LexiPlay team`,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${heading}</title></head>
<body style="margin:0;padding:0;background:#f3f6f2;font-family:Arial,Helvetica,sans-serif;color:#203125">
<div style="display:none;max-height:0;overflow:hidden">${heading}. Your link expires in ${expiry}.</div>
<table role="presentation" style="width:100%;border-collapse:collapse"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" style="width:100%;max-width:560px;border-collapse:collapse;background:#ffffff;border:1px solid #dfe7dd;border-radius:16px">
<tr><td style="padding:28px 28px 20px;border-bottom:1px solid #e6ebe4"><span style="display:inline-block;padding:8px 12px;border-radius:8px;background:#e5efdf;color:#376337;font-size:21px;font-weight:bold">L</span><span style="margin-left:12px;font-size:22px;font-weight:bold">LexiPlay</span><p style="margin:12px 0 0;font-size:12px;letter-spacing:1.5px;color:#637160">ACCOUNT SERVICES</p></td></tr>
<tr><td style="padding:28px"><h1 style="margin:0 0 24px;font-size:26px;line-height:1.3">${heading}</h1><p style="font-size:15px;line-height:1.7">Hello,</p><p style="font-size:15px;line-height:1.7">${request}</p>
<p style="margin:28px 0"><a href="${url}" style="display:inline-block;padding:14px 22px;border-radius:8px;background:#376337;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold">${heading}</a></p>
<p style="font-size:14px;line-height:1.7"><strong>This link expires in ${expiry}</strong> and can be used only once.</p><p style="font-size:14px;line-height:1.7;color:#566451">${optional}</p>
<p style="margin-top:24px;font-size:13px;line-height:1.7;color:#566451">If the button does not work, copy and paste this address into your browser:</p><p style="font-size:12px;line-height:1.7;overflow-wrap:anywhere;word-break:break-all"><a href="${url}" style="color:#376337">${url}</a></p>
<p style="margin-top:24px;font-size:13px;line-height:1.7;color:#566451">If you did not request this email, no action is required. You can safely ignore it. Do not share this link with anyone.</p><p style="margin-top:24px;font-size:14px;line-height:1.7">Regards,<br>The LexiPlay team</p></td></tr>
<tr><td style="padding:20px 28px;border-top:1px solid #e6ebe4;font-size:12px;line-height:1.7;color:#637160">LexiPlay · Small steps, stronger words.<br>This is an automated account message.</td></tr></table>
</td></tr></table></body></html>`,
  };
}
