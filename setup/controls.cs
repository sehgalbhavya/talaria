// The setup window's controls, drawn to match Talaria's own UI (web/src/index.css and components/ui.tsx):
// warm off-white background, white cards with a hairline border, ink primary buttons, indigo switches
// and progress, and the onboarding's numbered step circles that turn gold when done.
// Compiled by setup.ps1 with the .NET Framework that ships with Windows, so it is C# 5.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Globalization;
using System.Text.RegularExpressions;
using System.Windows.Forms;

namespace TalariaSetup
{
    public static class Theme
    {
        public static float S = 1f; // screen scale: 1 at 100%, 1.5 at 150%

        public static readonly Color Bg = Color.FromArgb(244, 243, 239);
        public static readonly Color Panel = Color.FromArgb(249, 248, 245);
        public static readonly Color Card = Color.White;
        public static readonly Color Ink = Color.FromArgb(23, 22, 28);
        public static readonly Color Ink2 = Color.FromArgb(59, 58, 69);
        public static readonly Color Muted = Color.FromArgb(108, 107, 118);
        public static readonly Color Faint = Color.FromArgb(157, 156, 166);
        public static readonly Color Line = Color.FromArgb(230, 228, 222);
        public static readonly Color Line2 = Color.FromArgb(238, 236, 231);
        public static readonly Color Accent = Color.FromArgb(74, 67, 212);
        public static readonly Color AccentSoft = Color.FromArgb(237, 236, 253);
        public static readonly Color Gold = Color.FromArgb(185, 124, 18);
        public static readonly Color GoldSoft = Color.FromArgb(251, 241, 221);
        public static readonly Color Ok = Color.FromArgb(24, 136, 74);
        public static readonly Color OkSoft = Color.FromArgb(227, 244, 233);
        public static readonly Color Bad = Color.FromArgb(207, 58, 76);
        public static readonly Color BadSoft = Color.FromArgb(251, 231, 233);

        public static GraphicsPath Round(RectangleF r, float radius)
        {
            var p = new GraphicsPath();
            float d = Math.Min(radius * 2, Math.Min(r.Width, r.Height));
            if (d <= 0) { p.AddRectangle(r); return p; }
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }

        public static void Smooth(Graphics g)
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
        }

        public static Color Fade(Color c, int alpha) { return Color.FromArgb(alpha, c); }

        public static Color Mix(Color a, Color b, float t)
        {
            return Color.FromArgb((int)(a.R + (b.R - a.R) * t), (int)(a.G + (b.G - a.G) * t), (int)(a.B + (b.B - a.B) * t));
        }
    }

    /// Base for everything here: double-buffered, painted by us.
    public class Smooth : Control
    {
        public Smooth()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
        }
    }

    /// A white card with rounded corners and a hairline border, like the app's cards.
    public class CardPanel : Panel
    {
        public Color Border = Theme.Line;
        public Color Fill = Theme.Card;
        public float Radius = 12;

        public CardPanel()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
            BackColor = Theme.Bg;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            Theme.Smooth(g);
            g.Clear(BackColor);
            var r = new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f);
            using (var path = Theme.Round(r, Radius * Theme.S))
            using (var fill = new SolidBrush(Fill))
            using (var pen = new Pen(Border, Math.Max(1f, Theme.S)))
            {
                g.FillPath(fill, path);
                g.DrawPath(pen, path);
            }
        }
    }

    /// Talaria's buttons: Primary is the dark ink button, otherwise the white one with a border.
    public class FlatButton : Smooth
    {
        public bool Primary;
        bool hover, down;

        public FlatButton()
        {
            Cursor = Cursors.Hand;
            BackColor = Theme.Bg;
        }

        protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hover = false; down = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnMouseDown(MouseEventArgs e) { down = true; Invalidate(); base.OnMouseDown(e); }
        protected override void OnMouseUp(MouseEventArgs e) { down = false; Invalidate(); base.OnMouseUp(e); }
        protected override void OnEnabledChanged(EventArgs e) { Cursor = Enabled ? Cursors.Hand : Cursors.Default; Invalidate(); base.OnEnabledChanged(e); }
        protected override void OnTextChanged(EventArgs e) { Invalidate(); base.OnTextChanged(e); }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            Theme.Smooth(g);
            g.Clear(BackColor);
            float dy = down ? Theme.S : 0;
            var r = new RectangleF(0.5f, 0.5f + dy, Width - 1.5f, Height - 2.5f);
            Color fill, text, border;
            if (Primary) { fill = hover ? Theme.Ink2 : Theme.Ink; text = Color.White; border = fill; }
            else { fill = hover ? Theme.Panel : Theme.Card; text = Theme.Ink; border = Theme.Line; }
            if (!Enabled) { fill = Theme.Mix(fill, BackColor, 0.5f); text = Theme.Mix(text, fill, 0.45f); border = Theme.Mix(border, BackColor, 0.5f); }
            using (var path = Theme.Round(r, 10 * Theme.S))
            {
                if (Primary && Enabled)
                {
                    using (var shadow = Theme.Round(new RectangleF(r.X, r.Y + Theme.S, r.Width, r.Height), 10 * Theme.S))
                    using (var sb = new SolidBrush(Theme.Fade(Color.Black, 30))) g.FillPath(sb, shadow);
                }
                using (var b = new SolidBrush(fill)) g.FillPath(b, path);
                using (var p = new Pen(border, Math.Max(1f, Theme.S))) g.DrawPath(p, path);
            }
            TextRenderer.DrawText(g, Text, Font, Rectangle.Round(r), text, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
        }
    }

    /// The app's thin rounded progress bar. Value is 0..1 and glides there; Busy shows a moving segment.
    public class ProgressLine : Smooth
    {
        float value, shown, phase;
        bool busy;
        public Color Fill = Theme.Accent;
        readonly Timer timer = new Timer();

        public ProgressLine()
        {
            BackColor = Theme.Bg;
            timer.Interval = 16;
            timer.Tick += delegate { Step(); };
            timer.Start();
        }

        public float Value { get { return value; } set { this.value = Math.Max(0, Math.Min(1, value)); busy = false; } }
        public bool Busy { get { return busy; } set { busy = value; } }
        public void Jump(float v) { value = shown = Math.Max(0, Math.Min(1, v)); busy = false; Invalidate(); }

        void Step()
        {
            if (busy) { phase = (phase + 0.009f) % 1.4f; Invalidate(); return; }
            if (Math.Abs(value - shown) > 0.001f) { shown += (value - shown) * 0.18f; Invalidate(); }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            Theme.Smooth(g);
            g.Clear(BackColor);
            float h = Height, rad = h / 2;
            using (var track = Theme.Round(new RectangleF(0, 0, Width - 0.5f, h - 0.5f), rad))
            using (var tb = new SolidBrush(Theme.Line2)) g.FillPath(tb, track);
            RectangleF bar;
            if (busy)
            {
                float w = Width * 0.32f;
                float x = (phase - 0.32f) * Width;
                bar = RectangleF.Intersect(new RectangleF(x, 0, w, h - 0.5f), new RectangleF(0, 0, Width, h));
            }
            else bar = new RectangleF(0, 0, Width * shown, h - 0.5f);
            if (bar.Width < 1) return;
            using (var path = Theme.Round(bar, rad))
            using (var fb = new SolidBrush(Fill)) g.FillPath(fb, path);
        }

        protected override void Dispose(bool disposing) { if (disposing) timer.Dispose(); base.Dispose(disposing); }
    }

    /// The app's switch: indigo when on, with a white thumb that slides.
    public class Toggle : Smooth
    {
        bool on;
        float pos;
        readonly Timer timer = new Timer();
        public event EventHandler CheckedChanged;

        public Toggle()
        {
            Cursor = Cursors.Hand;
            BackColor = Theme.Card;
            timer.Interval = 16;
            timer.Tick += delegate
            {
                float target = on ? 1 : 0;
                if (Math.Abs(pos - target) < 0.02f) { pos = target; timer.Stop(); }
                else pos += (target - pos) * 0.3f;
                Invalidate();
            };
        }

        public bool Checked
        {
            get { return on; }
            set { if (on == value) return; on = value; timer.Start(); if (CheckedChanged != null) CheckedChanged(this, EventArgs.Empty); }
        }

        public void Set(bool value) { on = value; pos = value ? 1 : 0; Invalidate(); }

        protected override void OnClick(EventArgs e) { if (Enabled) Checked = !Checked; base.OnClick(e); }
        protected override void OnEnabledChanged(EventArgs e) { Cursor = Enabled ? Cursors.Hand : Cursors.Default; Invalidate(); base.OnEnabledChanged(e); }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            Theme.Smooth(g);
            g.Clear(BackColor);
            float h = Height - 1, w = Width - 1;
            Color track = Theme.Mix(Theme.Line, Theme.Accent, pos);
            if (!Enabled) track = Theme.Mix(track, BackColor, 0.5f);
            using (var path = Theme.Round(new RectangleF(0, 0, w, h), h / 2))
            using (var b = new SolidBrush(track)) g.FillPath(b, path);
            float d = h - 4 * Theme.S, x = 2 * Theme.S + (w - h) * pos;
            using (var sb = new SolidBrush(Theme.Fade(Color.Black, 40))) g.FillEllipse(sb, x, 2 * Theme.S + Theme.S * 0.8f, d, d);
            using (var tb = new SolidBrush(Color.White)) g.FillEllipse(tb, x, 2 * Theme.S, d, d);
        }

        protected override void Dispose(bool disposing) { if (disposing) timer.Dispose(); base.Dispose(disposing); }
    }

    /// The onboarding's step circle: a number, a spinner while working, gold with a tick when done.
    public class StepIcon : Smooth
    {
        string state = "pending";
        public int Number = 1;
        float angle;
        readonly Timer timer = new Timer();

        public StepIcon()
        {
            BackColor = Theme.Card;
            timer.Interval = 16;
            timer.Tick += delegate { angle = (angle + 6) % 360; Invalidate(); };
        }

        /// pending, active, done, failed, skipped
        public string State
        {
            get { return state; }
            set { state = value; if (state == "active") timer.Start(); else timer.Stop(); Invalidate(); }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            Theme.Smooth(g);
            g.Clear(BackColor);
            float s = Math.Min(Width, Height) - 1, w = Math.Max(1.5f, 1.5f * Theme.S);
            var r = new RectangleF(w / 2, w / 2, s - w, s - w);
            var center = new RectangleF(0, 0, s, s);
            if (state == "done")
            {
                using (var b = new SolidBrush(Theme.Gold)) g.FillEllipse(b, r);
                using (var p = new Pen(Color.FromArgb(18, 17, 22), 2.2f * Theme.S) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round })
                    g.DrawLines(p, new[] { new PointF(s * 0.3f, s * 0.52f), new PointF(s * 0.44f, s * 0.66f), new PointF(s * 0.71f, s * 0.37f) });
                return;
            }
            if (state == "failed")
            {
                using (var b = new SolidBrush(Theme.BadSoft)) g.FillEllipse(b, r);
                using (var p = new Pen(Theme.Bad, w)) g.DrawEllipse(p, r);
                TextRenderer.DrawText(g, "!", new Font("Segoe UI Semibold", 12.5f * Theme.S, GraphicsUnit.Pixel), Rectangle.Round(center), Theme.Bad, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
                return;
            }
            if (state == "active")
            {
                using (var b = new SolidBrush(Theme.AccentSoft)) g.FillEllipse(b, r);
                using (var p = new Pen(Theme.Accent, 2.2f * Theme.S) { StartCap = LineCap.Round, EndCap = LineCap.Round })
                    g.DrawArc(p, new RectangleF(r.X + 3 * Theme.S, r.Y + 3 * Theme.S, r.Width - 6 * Theme.S, r.Height - 6 * Theme.S), angle, 250);
                return;
            }
            using (var p = new Pen(Theme.Line, w)) g.DrawEllipse(p, r);
            if (state == "skipped")
            {
                using (var p = new Pen(Theme.Faint, 1.6f * Theme.S) { StartCap = LineCap.Round, EndCap = LineCap.Round })
                    g.DrawLine(p, s * 0.36f, s / 2, s * 0.64f, s / 2);
                return;
            }
            TextRenderer.DrawText(g, Number.ToString(CultureInfo.InvariantCulture), new Font("Segoe UI Semibold", 11.5f * Theme.S, GraphicsUnit.Pixel), Rectangle.Round(center), Theme.Muted, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
        }

        protected override void Dispose(bool disposing) { if (disposing) timer.Dispose(); base.Dispose(disposing); }
    }

    /// Talaria's mark: three gold feathers on the dark rounded square (components/brand.tsx).
    public class LogoMark : Smooth
    {
        static readonly string[] Feathers =
        {
            "M5 22.5c4.6.2 9.4-1.2 13.6-4.6 2.6-2.2 4.6-4.9 6.1-8-1.7 5.4-4.8 9.7-9.1 12.5-3.2 2.1-6.8 2.8-10.6 2.3z",
            "M6.8 18.6c3.5-.3 7-1.9 9.8-4.4 1.8-1.5 3.2-3.4 4.3-5.5-1.2 3.7-3.4 6.7-6.3 8.6-2.3 1.5-4.9 2.2-7.8 2.1z",
            "M8.9 14.9c2.4-.5 4.7-1.7 6.6-3.5 1.1-1 2-2.2 2.6-3.5-.7 2.5-2.1 4.6-4 5.9-1.5 1.1-3.3 1.5-5.2 1.1z",
        };

        public LogoMark() { BackColor = Theme.Bg; }

        static GraphicsPath Parse(string d, float scale, float ox, float oy)
        {
            var path = new GraphicsPath();
            var tokens = Regex.Matches(d, @"[Mmcz]|-?(?:\d+\.?\d*|\.\d+)");
            var nums = new List<float>();
            char cmd = ' ';
            PointF cur = PointF.Empty;
            Func<float, float, PointF> at = (x, y) => new PointF(ox + x * scale, oy + y * scale);
            foreach (Match m in tokens)
            {
                string t = m.Value;
                if (t == "M" || t == "m" || t == "c") { cmd = t[0]; nums.Clear(); continue; }
                if (t == "z") { path.CloseFigure(); continue; }
                nums.Add(float.Parse(t, CultureInfo.InvariantCulture));
                if ((cmd == 'M' || cmd == 'm') && nums.Count == 2) { cur = new PointF(nums[0], nums[1]); path.StartFigure(); nums.Clear(); }
                else if (cmd == 'c' && nums.Count == 6)
                {
                    var p1 = new PointF(cur.X + nums[0], cur.Y + nums[1]);
                    var p2 = new PointF(cur.X + nums[2], cur.Y + nums[3]);
                    var p3 = new PointF(cur.X + nums[4], cur.Y + nums[5]);
                    path.AddBezier(at(cur.X, cur.Y), at(p1.X, p1.Y), at(p2.X, p2.Y), at(p3.X, p3.Y));
                    cur = p3;
                    nums.Clear();
                }
            }
            return path;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            Theme.Smooth(g);
            g.Clear(BackColor);
            float s = Math.Min(Width, Height) - 1;
            using (var path = Theme.Round(new RectangleF(0, 0, s, s), s * 0.28f))
            using (var b = new SolidBrush(Theme.Ink)) g.FillPath(b, path);
            float inner = s * 0.75f, off = (s - inner) / 2, scale = inner / 30f;
            var fills = new[] { Theme.Gold, Theme.Mix(Theme.Gold, Color.White, 0.35f), Theme.Mix(Theme.Gold, Color.White, 0.65f) };
            for (int i = 0; i < Feathers.Length; i++)
                using (var p = Parse(Feathers[i], scale, off, off))
                using (var b = new SolidBrush(fills[i])) g.FillPath(b, p);
        }
    }
}
