// Joint Domain Data Compiler launcher (Windows).
//
// Exists for one reason: to put the splash on screen the instant the user
// double-clicks, which Electron cannot do. Before Electron runs a single line of
// the app, Windows has to load -- and antivirus has to scan -- a ~190 MB
// unsigned executable and its DLLs. On a cold machine that took long enough
// that users saw nothing at all, then the app's own splash flashing open and
// shut as the workbench appeared right behind it. No window created by the app
// can cover time that passes before the app exists.
//
// This program is ~30 KB and needs only the .NET Framework that ships with
// Windows 10 and 11. It paints the same splash art, bar and status line at
// once, starts the real executable, and closes the moment the app's own splash
// (placed over exactly the same rectangle) is visible. It forwards every
// argument and inherits the environment, so it is transparent to anything that
// starts it.
//
// Written to C# 5 on purpose: that is the compiler in every .NET Framework 4.x
// install (%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe), which is
// what scripts/build-launcher.mjs uses -- no SDK, no NuGet, nothing to fetch.

using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace Jddc.Launcher
{
    internal static class Program
    {
        // Must match package.json build.appId, which the installer stamps on its
        // shortcuts and electron/main.cjs passes to app.setAppUserModelId: one ID
        // keeps this splash, the app's splash and the workbench under a single
        // taskbar button.
        internal const string AppUserModelId = "com.a13xg.jointdomaindatacompiler";
        internal const string AppExeName = "JointDomainDataCompiler.exe";
        internal const string ProductName = "Joint Domain Data Compiler";
        // The app's userData folder under %APPDATA%. Electron names it from
        // package.json's top-level `name` (there is no top-level productName),
        // so it is NOT the product name; test/launcher.ts pins the two together.
        internal const string UserDataFolderName = "joint-domain-data-compiler";

        [STAThread]
        private static int Main(string[] args)
        {
            long spawnedAtMs = Clock.EpochMs();
            Log.Open();
            Log.Write("launcher started, arguments: " + string.Join(" ", args));

            // --render-splash <out.png> [progress] [hint]: draw the splash to a
            // file and exit. Lets the drawing be checked without a window, on any
            // machine that can run the assembly.
            if (args.Length >= 2 && args[0] == "--render-splash")
            {
                double progress = args.Length >= 3 ? double.Parse(args[2], CultureInfo.InvariantCulture) : 0.12;
                bool hint = args.Length >= 4 && args[3] == "hint";
                SplashPainter.RenderToFile(args[1], progress, hint);
                return 0;
            }

            // --print-command-line <args...>: print how the arguments would be
            // forwarded to the app, for test/launcher.ts.
            if (args.Length >= 1 && args[0] == "--print-command-line")
            {
                string[] rest = new string[args.Length - 1];
                Array.Copy(args, 1, rest, 0, rest.Length);
                Console.Out.Write(CommandLine.Join(rest));
                Console.Out.Flush();
                return 0;
            }

            try { NativeMethods.SetProcessDPIAware(); } catch (Exception) { }
            try { NativeMethods.SetCurrentProcessExplicitAppUserModelID(AppUserModelId); } catch (Exception) { }

            string appExe = FindApp(AppDomain.CurrentDomain.BaseDirectory);
            if (appExe == null)
            {
                Log.Write("app executable not found beside " + AppDomain.CurrentDomain.BaseDirectory);
                MessageBox.Show(
                    "Joint Domain Data Compiler could not find its program files (" + AppExeName + ") next to this launcher.\n\n" +
                    "If you opened it from inside the .zip, extract the whole zip first (right-click the zip, Extract All...), " +
                    "then open the extracted \"" + ProductName + "\" folder and run \"" + ProductName + ".exe\" from there.",
                    ProductName, MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 2;
            }

            // A copy already on screen needs no splash: the new process hands off
            // to it within milliseconds and it raises its own window. "On
            // screen", not merely "running": a copy stuck before its first window,
            // or one closing down, or the renderer and crash-handler helpers that
            // share its image name, must not cost the user the splash -- that was
            // the original complaint.
            bool alreadyRunning = WindowFinder.AnyVisibleWindowOf(Path.GetFileNameWithoutExtension(AppExeName));
            Log.Write(alreadyRunning ? "a running copy already has a window on screen" : "no running copy on screen");
            bool splashOwner;
            using (Mutex splashMutex = new Mutex(true, @"Local\JDDC-Launcher-Splash", out splashOwner))
            {
                if (alreadyRunning || !splashOwner)
                {
                    Log.Write(alreadyRunning ? "app already running; starting it without a splash" : "another launcher is showing the splash; starting without one");
                    try
                    {
                        ChildLauncher.Start(appExe, args, spawnedAtMs, null);
                        return 0;
                    }
                    catch (Exception error)
                    {
                        return ReportStartFailure(appExe, error);
                    }
                }

                // The app is started FIRST, on its own thread, while this thread
                // builds the splash. Starting it here would hold the splash back
                // for as long as CreateProcess blocks -- and it blocks while
                // antivirus scans the 190 MB executable, the very gap this
                // program exists to cover. Starting it after the splash (the
                // first version) delayed the app by this process's own start-up,
                // ~750 ms on the release runner.
                Rectangle bounds = SplashForm.CenteredBounds();
                ChildStarter starter = new ChildStarter(appExe, args, spawnedAtMs, bounds);
                Log.Write(string.Format(CultureInfo.InvariantCulture, "app start requested {0} ms after launch", Clock.EpochMs() - spawnedAtMs));

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                SplashForm form = new SplashForm(starter, appExe, spawnedAtMs, bounds);
                Log.Write(string.Format(CultureInfo.InvariantCulture, "splash built {0} ms after launch", Clock.EpochMs() - spawnedAtMs));
                // On a fast machine the app's own splash can beat this one to the
                // screen; covering it with an identical picture would only add a
                // window to close.
                Process early = starter.Child;
                if (early != null && WindowFinder.DescribeVisibleWindow(early.Id, IntPtr.Zero) != null)
                {
                    Log.Write("app window already on screen before this splash; not showing it");
                    Log.Write("launcher exiting with code 0");
                    return 0;
                }
                Application.Run(form);
                Log.Write("launcher exiting with code " + form.ResultCode);
                return form.ResultCode;
            }
        }

        internal static int ReportStartFailure(string appExe, Exception error)
        {
            Log.Write("could not start " + appExe + ": " + error);
            MessageBox.Show(
                "Joint Domain Data Compiler could not be started.\n\n" + error.Message +
                "\n\nIf security software blocked it, allow \"" + appExe + "\" and try again.\n\nLauncher log: " + Log.FilePath,
                ProductName, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 3;
        }

        // Beside the launcher (installed copy), or in its app\ folder (the zip,
        // where only the launcher and a README sit at the top level).
        private static string FindApp(string baseDir)
        {
            string[] candidates = { Path.Combine(baseDir, AppExeName), Path.Combine(Path.Combine(baseDir, "app"), AppExeName) };
            foreach (string candidate in candidates)
            {
                if (File.Exists(candidate)) return candidate;
            }
            return null;
        }
    }

    internal static class ChildLauncher
    {
        internal static Process Start(string appExe, string[] args, long spawnedAtMs, Rectangle? splashBounds)
        {
            ProcessStartInfo info = new ProcessStartInfo(appExe);
            // CreateProcess, not ShellExecute: a shell launch of a downloaded
            // (Mark-of-the-Web) executable can raise a second SmartScreen prompt.
            info.UseShellExecute = false;
            info.WorkingDirectory = Path.GetDirectoryName(appExe);
            info.Arguments = CommandLine.Join(args);
            // The environment is inherited as-is; these are added for the app.
            info.EnvironmentVariables["JDDC_LAUNCHER_PID"] = Process.GetCurrentProcess().Id.ToString(CultureInfo.InvariantCulture);
            // When the user actually double-clicked, so the app's log can report
            // the whole gap before its own code ran.
            info.EnvironmentVariables["JDDC_SPAWN_MS"] = spawnedAtMs.ToString(CultureInfo.InvariantCulture);
            if (splashBounds.HasValue)
            {
                Rectangle b = splashBounds.Value;
                info.EnvironmentVariables["JDDC_LAUNCHER_BOUNDS"] = string.Format(CultureInfo.InvariantCulture, "{0},{1},{2},{3}", b.X, b.Y, b.Width, b.Height);
            }
            Process child = Process.Start(info);
            Log.Write("started " + appExe + " as pid " + child.Id + " with arguments: " + info.Arguments);
            return child;
        }
    }

    // Starts the app on a background thread and publishes the outcome for the
    // UI thread's timer to pick up.
    internal sealed class ChildStarter
    {
        private volatile Process child;
        private volatile Exception error;

        internal ChildStarter(string appExe, string[] args, long spawnedAtMs, Rectangle bounds)
        {
            Thread thread = new Thread(delegate ()
            {
                try { child = ChildLauncher.Start(appExe, args, spawnedAtMs, bounds); }
                catch (Exception e) { error = e; }
            });
            thread.IsBackground = true;
            thread.Start();
        }

        internal Process Child { get { return child; } }
        internal Exception Error { get { return error; } }
    }

    internal sealed class SplashForm : Form
    {
        // How long after the app's own window appears to keep this one up, so
        // the swap happens under an already-painted window rather than over a
        // blank one.
        private const int HandoffOverlapMs = 250;
        // How long one launch may go without the app's window before the splash
        // says, in words, that it is still working.
        private const int SlowHintMs = 4000;

        private readonly ChildStarter starter;
        private readonly string appExe;
        private readonly long spawnedAtMs;
        private readonly Stopwatch clock = Stopwatch.StartNew();
        private readonly System.Windows.Forms.Timer tick = new System.Windows.Forms.Timer();
        private readonly SplashPainter painter;
        private Process child;
        private long handoffSeenMs = -1;
        private bool closing;

        internal int ResultCode { get; private set; }

        internal SplashForm(ChildStarter starter, string appExe, long spawnedAtMs, Rectangle bounds)
        {
            this.starter = starter;
            this.appExe = appExe;
            this.spawnedAtMs = spawnedAtMs;
            painter = new SplashPainter(VersionOf(appExe));

            Text = "Starting " + Program.ProductName;
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = true;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            BackColor = SplashPainter.Ink;
            DoubleBuffered = true;
            KeyPreview = true;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch (Exception) { }

            Bounds = bounds;
            tick.Interval = 33;
            tick.Tick += OnTick;
        }

        // The same logical size as the app's splash (800x343), scaled to the
        // primary display's DPI, centred in its work area. The app is told this
        // exact rectangle and opens its splash over it.
        internal static Rectangle CenteredBounds()
        {
            float scale = 1f;
            using (Graphics screenGraphics = Graphics.FromHwnd(IntPtr.Zero)) scale = screenGraphics.DpiX / 96f;
            Size size = new Size((int)Math.Round(SplashPainter.LogicalWidth * scale), (int)Math.Round(SplashPainter.LogicalHeight * scale));
            Rectangle area = Screen.PrimaryScreen.WorkingArea;
            return new Rectangle(area.Left + (area.Width - size.Width) / 2, area.Top + (area.Height - size.Height) / 2, size.Width, size.Height);
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            Activate();
            Refresh();
            Log.Write(string.Format(CultureInfo.InvariantCulture, "splash shown {0} ms after launch", Clock.EpochMs() - spawnedAtMs));
            tick.Start();
        }

        protected override void OnKeyDown(KeyEventArgs e)
        {
            // Closes only this splash; the app keeps starting.
            if (e.KeyCode == Keys.Escape)
            {
                Log.Write("splash dismissed with Esc");
                Finish(0);
                return;
            }
            base.OnKeyDown(e);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            long elapsed = clock.ElapsedMilliseconds;
            // What is actually happening: first this process, then Windows loading
            // (and antivirus scanning) the app's runtime.
            string status = elapsed < 1200 ? "Starting Joint Domain Data Compiler" : "Loading application runtime";
            painter.Paint(e.Graphics, ClientRectangle, Progress(), status, elapsed >= SlowHintMs);
        }

        protected override void OnPaintBackground(PaintEventArgs e)
        {
            // Everything is painted in OnPaint; skipping the erase avoids a flicker.
        }

        // Eases toward the point where the app's own splash takes over (its
        // first stage starts the bar at 0.14), so the hand-off never moves the
        // bar backwards.
        private double Progress()
        {
            double seconds = clock.ElapsedMilliseconds / 1000.0;
            return 0.15 * (1 - Math.Exp(-seconds / 1.1));
        }

        private void OnTick(object sender, EventArgs e)
        {
            if (closing) return;
            Invalidate();

            if (starter.Error != null)
            {
                tick.Stop();
                Hide();
                Finish(Program.ReportStartFailure(appExe, starter.Error));
                return;
            }
            // Still inside CreateProcess -- typically antivirus scanning the
            // executable. This splash is exactly what covers that.
            if (child == null) child = starter.Child;
            if (child == null) return;

            if (child.HasExited)
            {
                int code = child.ExitCode;
                Log.Write("app exited with code " + code + " before showing a window");
                if (code == 0)
                {
                    // The normal hand-off to a copy that was already running.
                    Finish(0);
                    return;
                }
                tick.Stop();
                Hide();
                MessageBox.Show(
                    "Joint Domain Data Compiler stopped while starting (exit code " + code + ").\n\n" +
                    "Its log is in " + (Log.Directory ?? @"%APPDATA%\joint-domain-data-compiler\logs") + "\\main.log",
                    Program.ProductName, MessageBoxButtons.OK, MessageBoxIcon.Error);
                Finish(code);
                return;
            }

            if (handoffSeenMs < 0)
            {
                string window = WindowFinder.DescribeVisibleWindow(child.Id, Handle);
                if (window != null)
                {
                    handoffSeenMs = clock.ElapsedMilliseconds;
                    Log.Write(string.Format(CultureInfo.InvariantCulture, "app window visible {0} ms after launch ({1}); handing off", Clock.EpochMs() - spawnedAtMs, window));
                }
            }
            else if (clock.ElapsedMilliseconds - handoffSeenMs >= HandoffOverlapMs)
            {
                Finish(0);
            }
        }

        private void Finish(int code)
        {
            if (closing) return;
            closing = true;
            tick.Stop();
            ResultCode = code;
            Close();
        }

        private static string VersionOf(string exe)
        {
            try
            {
                string version = FileVersionInfo.GetVersionInfo(exe).ProductVersion;
                return string.IsNullOrEmpty(version) ? null : "v" + version;
            }
            catch (Exception)
            {
                return null;
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                tick.Dispose();
                painter.Dispose();
            }
            base.Dispose(disposing);
        }
    }

    // Draws the splash: the same plate, scrim, bar and status line as
    // electron/splash.html, so the hand-off to the app's splash is a swap of
    // identical pictures. Coordinates are the page's CSS pixels, scaled.
    internal sealed class SplashPainter : IDisposable
    {
        internal const int LogicalWidth = 800;
        internal const int LogicalHeight = 343;
        internal static readonly Color Ink = Color.FromArgb(5, 11, 24);
        private static readonly Color Text = Color.FromArgb(168, 200, 228);
        private static readonly Color TextDim = Color.FromArgb(93, 119, 147);

        private readonly Image plate;
        private readonly string version;

        internal SplashPainter(string version)
        {
            this.version = version;
            Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("Jddc.splash.png");
            if (stream != null)
            {
                using (stream) plate = Image.FromStream(new MemoryStream(ReadAll(stream)));
            }
        }

        internal void Paint(Graphics g, Rectangle bounds, double progress, string statusText, bool showHint)
        {
            float s = bounds.Width / (float)LogicalWidth;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;

            using (SolidBrush ink = new SolidBrush(Ink)) g.FillRectangle(ink, bounds);
            if (plate != null) g.DrawImage(plate, bounds);

            // .scrim: the bottom 132 px fade to near-opaque ink.
            RectangleF scrim = new RectangleF(0, bounds.Height - 132 * s, bounds.Width, 132 * s + 1);
            using (LinearGradientBrush brush = new LinearGradientBrush(scrim, Color.FromArgb(0, 5, 11, 24), Color.FromArgb(237, 4, 9, 20), LinearGradientMode.Vertical))
            {
                ColorBlend blend = new ColorBlend();
                blend.Colors = new[] { Color.FromArgb(0, 5, 11, 24), Color.FromArgb(115, 5, 11, 24), Color.FromArgb(237, 4, 9, 20) };
                blend.Positions = new[] { 0f, 0.38f, 1f };
                brush.InterpolationColors = blend;
                g.FillRectangle(brush, scrim);
            }

            // Frame edge, as the page's inset box-shadow.
            using (Pen edge = new Pen(Color.FromArgb(41, 125, 211, 252), Math.Max(1f, s))) g.DrawRectangle(edge, 0, 0, bounds.Width - 1, bounds.Height - 1);

            // .bar: 6 px inset track, 24 px from the sides, 14 px from the bottom.
            RectangleF track = new RectangleF(24 * s, bounds.Height - (14 + 6) * s, bounds.Width - 48 * s, 6 * s);
            using (GraphicsPath path = Rounded(track, 3 * s))
            using (SolidBrush trackBrush = new SolidBrush(Color.FromArgb(51, 148, 190, 230)))
            {
                g.FillPath(trackBrush, path);
            }
            float fillWidth = (float)(track.Width * Math.Max(0, Math.Min(1, progress)));
            if (fillWidth >= 1)
            {
                RectangleF fill = new RectangleF(track.X, track.Y, fillWidth, track.Height);
                using (GraphicsPath path = Rounded(fill, 3 * s))
                using (LinearGradientBrush brush = new LinearGradientBrush(new RectangleF(fill.X - 1, fill.Y, fill.Width + 2, fill.Height), Color.FromArgb(34, 211, 238), Color.FromArgb(245, 197, 66), LinearGradientMode.Horizontal))
                {
                    ColorBlend blend = new ColorBlend();
                    blend.Colors = new[] { Color.FromArgb(34, 211, 238), Color.FromArgb(125, 211, 252), Color.FromArgb(245, 197, 66) };
                    blend.Positions = new[] { 0f, 0.55f, 1f };
                    brush.InterpolationColors = blend;
                    g.FillPath(brush, path);
                }
            }

            // .footer: version bottom-left (dim), status bottom-right with its pip.
            using (Font small = new Font("Segoe UI", 7.9f * s, FontStyle.Regular, GraphicsUnit.Point))
            {
                float baseline = bounds.Height - 30 * s;
                if (version != null)
                {
                    using (SolidBrush dim = new SolidBrush(TextDim))
                    {
                        SizeF v = g.MeasureString(version, small);
                        g.DrawString(version, small, dim, 24 * s, baseline - v.Height);
                    }
                }
                string status = statusText.ToUpperInvariant();
                using (SolidBrush text = new SolidBrush(Text))
                {
                    SizeF size = g.MeasureString(status, small);
                    float x = bounds.Width - 24 * s - size.Width;
                    g.DrawString(status, small, text, x, baseline - size.Height);
                    float pip = 5 * s;
                    using (SolidBrush cyan = new SolidBrush(Color.FromArgb(56, 189, 248)))
                    {
                        g.FillEllipse(cyan, x - 9 * s - pip / 2, baseline - size.Height / 2 - pip / 2, pip, pip);
                    }
                }
            }

            if (showHint)
            {
                const string hint = "Still starting… the first launch after an install or update can take longer while security software checks the app. No need to start it again.";
                using (Font hintFont = new Font("Segoe UI", 8.6f * s, FontStyle.Regular, GraphicsUnit.Point))
                {
                    float maxWidth = 470 * s - 22 * s;
                    SizeF size = g.MeasureString(hint, hintFont, (int)maxWidth);
                    RectangleF box = new RectangleF(18 * s, bounds.Height - 50 * s - size.Height - 14 * s, size.Width + 22 * s, size.Height + 14 * s);
                    using (GraphicsPath path = Rounded(box, 6 * s))
                    using (SolidBrush back = new SolidBrush(Color.FromArgb(224, 4, 9, 20)))
                    using (Pen border = new Pen(Color.FromArgb(46, 125, 211, 252), Math.Max(1f, s)))
                    using (SolidBrush text = new SolidBrush(Text))
                    {
                        g.FillPath(back, path);
                        g.DrawPath(border, path);
                        g.DrawString(hint, hintFont, text, new RectangleF(box.X + 11 * s, box.Y + 7 * s, maxWidth, size.Height + 2));
                    }
                }
            }
        }

        internal static void RenderToFile(string path, double progress, bool hint)
        {
            using (SplashPainter painter = new SplashPainter("v0.0.0"))
            using (Bitmap bitmap = new Bitmap(LogicalWidth, LogicalHeight))
            using (Graphics g = Graphics.FromImage(bitmap))
            {
                painter.Paint(g, new Rectangle(0, 0, LogicalWidth, LogicalHeight), progress, hint ? "Loading application runtime" : "Starting Joint Domain Data Compiler", hint);
                bitmap.Save(path, System.Drawing.Imaging.ImageFormat.Png);
            }
        }

        private static GraphicsPath Rounded(RectangleF r, float radius)
        {
            GraphicsPath path = new GraphicsPath();
            float d = Math.Min(radius * 2, Math.Min(r.Width, r.Height));
            if (d <= 0.5f)
            {
                path.AddRectangle(r);
                return path;
            }
            path.AddArc(r.X, r.Y, d, d, 180, 90);
            path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }

        private static byte[] ReadAll(Stream stream)
        {
            using (MemoryStream copy = new MemoryStream())
            {
                stream.CopyTo(copy);
                return copy.ToArray();
            }
        }

        public void Dispose()
        {
            if (plate != null) plate.Dispose();
        }
    }

    internal static class WindowFinder
    {
        // The first visible top-level window of the process -- its splash, the
        // workbench if the splash was skipped, or an error dialog, any of which
        // means this splash should step aside -- described for the log, so a
        // user's launcher.log says exactly what the hand-off happened to.
        internal static string DescribeVisibleWindow(int processId, IntPtr ignore)
        {
            string found = null;
            NativeMethods.EnumWindows(delegate (IntPtr hwnd, IntPtr lParam)
            {
                if (hwnd == ignore || !NativeMethods.IsWindowVisible(hwnd)) return true;
                uint owner;
                NativeMethods.GetWindowThreadProcessId(hwnd, out owner);
                if (owner != (uint)processId) return true;
                StringBuilder title = new StringBuilder(256);
                StringBuilder className = new StringBuilder(256);
                NativeMethods.GetWindowText(hwnd, title, title.Capacity);
                NativeMethods.GetClassName(hwnd, className, className.Capacity);
                NativeMethods.Rect rect;
                NativeMethods.GetWindowRect(hwnd, out rect);
                found = string.Format(CultureInfo.InvariantCulture, "class {0}, title \"{1}\", at {2},{3} {4}x{5}",
                    className, title, rect.Left, rect.Top, rect.Right - rect.Left, rect.Bottom - rect.Top);
                return false;
            }, IntPtr.Zero);
            return found;
        }

        internal static bool AnyVisibleWindowOf(string imageName)
        {
            foreach (Process process in Process.GetProcessesByName(imageName))
            {
                using (process)
                {
                    if (DescribeVisibleWindow(process.Id, IntPtr.Zero) != null) return true;
                }
            }
            return false;
        }
    }

    // Windows command-line quoting (the CommandLineToArgvW rules), since
    // .NET Framework's ProcessStartInfo takes one pre-joined string.
    internal static class CommandLine
    {
        internal static string Join(string[] args)
        {
            StringBuilder line = new StringBuilder();
            foreach (string arg in args)
            {
                if (line.Length > 0) line.Append(' ');
                line.Append(Quote(arg));
            }
            return line.ToString();
        }

        internal static string Quote(string arg)
        {
            if (arg.Length > 0 && arg.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0) return arg;
            StringBuilder quoted = new StringBuilder("\"");
            int backslashes = 0;
            foreach (char c in arg)
            {
                if (c == '\\')
                {
                    backslashes++;
                    continue;
                }
                if (c == '"')
                {
                    quoted.Append('\\', backslashes * 2 + 1);
                    quoted.Append('"');
                }
                else
                {
                    quoted.Append('\\', backslashes);
                    quoted.Append(c);
                }
                backslashes = 0;
            }
            quoted.Append('\\', backslashes * 2);
            quoted.Append('"');
            return quoted.ToString();
        }
    }

    internal static class Clock
    {
        private static readonly DateTime Epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        internal static long EpochMs() { return (long)(DateTime.UtcNow - Epoch).TotalMilliseconds; }
    }

    // <logs>\launcher.log beside the app's main.log, so one folder holds the
    // whole story of a launch. Never allowed to stop the launch.
    internal static class Log
    {
        internal static string FilePath { get; private set; }
        internal static string Directory { get; private set; }

        internal static void Open()
        {
            try
            {
                string configured = Environment.GetEnvironmentVariable("JDDC_LOG_DIR");
                string dir = !string.IsNullOrEmpty(configured)
                    ? configured
                    : Path.Combine(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), Program.UserDataFolderName), "logs");
                System.IO.Directory.CreateDirectory(dir);
                Directory = dir;
                FilePath = Path.Combine(dir, "launcher.log");
                FileInfo info = new FileInfo(FilePath);
                if (info.Exists && info.Length > 512 * 1024) File.Delete(FilePath);
            }
            catch (Exception)
            {
                FilePath = null;
            }
        }

        internal static void Write(string message)
        {
            if (FilePath == null) return;
            try
            {
                File.AppendAllText(FilePath, DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture) + " [" + Process.GetCurrentProcess().Id + "] " + message + Environment.NewLine);
            }
            catch (Exception)
            {
            }
        }
    }

    internal static class NativeMethods
    {
        internal delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

        [DllImport("user32.dll")]
        internal static extern bool SetProcessDPIAware();

        [DllImport("user32.dll")]
        internal static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

        [DllImport("user32.dll")]
        internal static extern bool IsWindowVisible(IntPtr hwnd);

        [DllImport("user32.dll")]
        internal static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);

        [StructLayout(LayoutKind.Sequential)]
        internal struct Rect
        {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        internal static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int maxCount);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        internal static extern int GetClassName(IntPtr hwnd, StringBuilder className, int maxCount);

        [DllImport("user32.dll")]
        internal static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
        internal static extern void SetCurrentProcessExplicitAppUserModelID(string appId);
    }
}
