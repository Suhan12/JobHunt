import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';
import 'package:universal_html/html.dart' as html;

void main() {
  runApp(const JobHuntReviewerApp());
}

class JobHuntReviewerApp extends StatelessWidget {
  const JobHuntReviewerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'JobHunt Reviewer',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF0F172A),
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFF38BDF8),
          secondary: Color(0xFF10B981),
          surface: Color(0xFF1E293B),
        ),
        cardTheme: CardThemeData(
          color: const Color(0xFF1E293B),
          elevation: 4,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
            side: const BorderSide(color: Color(0xFF334155), width: 1),
          ),
        ),
        useMaterial3: true,
      ),
      home: const JobReviewerScreen(),
    );
  }
}

// ── Status constants & helpers ──────────────────────────────────────────────
const Map<String, StatusMeta> statusConfig = {
  'NEW':                     StatusMeta('NEW',                     Icons.fiber_new,          Color(0xFF64748B), Color(0xFF1E293B)),
  'REVIEWED':                StatusMeta('REVIEWED',                Icons.visibility,         Color(0xFF8B5CF6), Color(0xFF2E1065)),
  'COVER_LETTER_GENERATED':  StatusMeta('COVER LETTER GENERATED',  Icons.auto_awesome,       Color(0xFFF59E0B), Color(0xFF422006)),
  'COVER_LETTER_SAVED':      StatusMeta('COVER LETTER SAVED',      Icons.save_alt,           Color(0xFF06B6D4), Color(0xFF083344)),
  'APPLIED':                 StatusMeta('APPLIED',                 Icons.check_circle,       Color(0xFF10B981), Color(0xFF064E3B)),
  'INTERVIEW':               StatusMeta('INTERVIEW',               Icons.groups,             Color(0xFF3B82F6), Color(0xFF1E3A5F)),
  'OFFER':                   StatusMeta('OFFER',                   Icons.celebration,         Color(0xFFF97316), Color(0xFF431407)),
  'REJECTED':                StatusMeta('REJECTED',                Icons.cancel,             Color(0xFFEF4444), Color(0xFF450A0A)),
  'WITHDRAWN':               StatusMeta('WITHDRAWN',               Icons.undo,               Color(0xFF6B7280), Color(0xFF1F2937)),
};

class StatusMeta {
  final String label;
  final IconData icon;
  final Color color;
  final Color bgColor;
  const StatusMeta(this.label, this.icon, this.color, this.bgColor);
}

StatusMeta getStatusMeta(String status) {
  return statusConfig[status.toUpperCase()] ?? const StatusMeta('UNKNOWN', Icons.help_outline, Color(0xFF64748B), Color(0xFF1E293B));
}

// ── Main Screen ─────────────────────────────────────────────────────────────
class JobReviewerScreen extends StatefulWidget {
  const JobReviewerScreen({super.key});

  @override
  State<JobReviewerScreen> createState() => _JobReviewerScreenState();
}

class _JobReviewerScreenState extends State<JobReviewerScreen> {
  List<dynamic> _jobs = [];
  bool _isLoading = true;
  String? _error;
  final Map<String, bool> _generatingState = {};
  final Map<String, bool> _downloadingState = {};
  final Map<String, String> _coverLetters = {};
  final Map<String, TextEditingController> _coverLetterControllers = {};
  final Map<String, bool> _expandedCards = {};

  String _customApiUrl = '';

  String get _baseUrl {
    if (_customApiUrl.trim().isNotEmpty) {
      return _customApiUrl.trim().replaceAll(RegExp(r'/$'), '');
    }
    return 'https://jobhunt-zgyu.onrender.com';
  }

  String get _cleanBase {
    String base = _baseUrl.trim().replaceAll(RegExp(r'/$'), '');
    if (base.endsWith('/jobs')) base = base.substring(0, base.length - 5);
    if (base.endsWith('/api/jobs')) base = base.substring(0, base.length - 9);
    return base;
  }

  @override
  void initState() {
    super.initState();
    _fetchJobs();
  }

  @override
  void dispose() {
    for (final c in _coverLetterControllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  // ── API Calls ───────────────────────────────────────────────────────────
  Future<void> _fetchJobs() async {
    setState(() { _isLoading = true; _error = null; });

    final endpoints = ['$_cleanBase/jobs', '$_cleanBase/api/jobs'];
    for (final ep in endpoints) {
      try {
        final r = await http.get(Uri.parse(ep), headers: {'Accept': 'application/json'});
        final body = r.body.trim();
        if (r.statusCode == 200 && !body.startsWith('<')) {
          final data = jsonDecode(body) as List;
          // Hydrate cover letters from saved applications
          for (final job in data) {
            final jobId = job['id'] as String;
            final apps = job['applications'] as List? ?? [];
            if (apps.isNotEmpty) {
              final latestLetter = apps.last['coverLetter'] as String? ?? '';
              if (latestLetter.isNotEmpty && !_coverLetters.containsKey(jobId)) {
                _coverLetters[jobId] = latestLetter;
                _coverLetterControllers[jobId]?.dispose();
                _coverLetterControllers[jobId] = TextEditingController(text: latestLetter);
              }
            }
          }
          setState(() { _jobs = data; _isLoading = false; });
          return;
        }
      } catch (_) {}
    }
    setState(() { _error = 'Failed to fetch jobs from $_cleanBase'; _isLoading = false; });
  }

  Future<void> _updateJobStatus(String jobId, String newStatus) async {
    try {
      final r = await http.patch(
        Uri.parse('$_cleanBase/jobs/$jobId/status'),
        headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
        body: jsonEncode({'status': newStatus}),
      );
      if (r.statusCode == 200) {
        // Update local state
        setState(() {
          for (int i = 0; i < _jobs.length; i++) {
            if (_jobs[i]['id'] == jobId) {
              _jobs[i]['status'] = newStatus;
              break;
            }
          }
        });
      } else {
        _snack('Status update failed: ${r.body}', isError: true);
      }
    } catch (e) {
      _snack('Error updating status: $e', isError: true);
    }
  }

  Future<void> _draftCoverLetter(Map<String, dynamic> job) async {
    final jobId = job['id'] as String;
    setState(() { _generatingState[jobId] = true; });

    try {
      final r = await http.post(
        Uri.parse('$_cleanBase/generate'),
        headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
        body: jsonEncode({'jobId': jobId}),
      );
      if (r.statusCode == 200) {
        final result = jsonDecode(r.body);
        final letter = result['coverLetter'] as String? ?? '';
        setState(() {
          _coverLetters[jobId] = letter;
          _coverLetterControllers[jobId] = TextEditingController(text: letter);
          _expandedCards[jobId] = true;
        });
        await _updateJobStatus(jobId, 'COVER_LETTER_GENERATED');
        _snack('Cover letter generated for ${job['company']}!');
      } else {
        _snack('Generation failed: ${r.body}', isError: true);
      }
    } catch (e) {
      _snack('Error: $e', isError: true);
    } finally {
      setState(() { _generatingState[jobId] = false; });
    }
  }

  Future<void> _downloadDocx(Map<String, dynamic> job) async {
    final jobId = job['id'] as String;
    final controller = _coverLetterControllers[jobId];
    if (controller == null) return;

    setState(() { _downloadingState[jobId] = true; });

    try {
      final r = await http.post(
        Uri.parse('$_cleanBase/generate-docx'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'jobId': jobId,
          'coverLetter': controller.text,
          'candidateName': 'Suhan Gautam',
          'jobTitle': job['title'] ?? '',
          'company': job['company'] ?? '',
        }),
      );

      if (r.statusCode == 200) {
        final bytes = r.bodyBytes;
        final blob = html.Blob([Uint8List.fromList(bytes)], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        final url = html.Url.createObjectUrlFromBlob(blob);
        final companyClean = (job['company'] ?? 'Cover').toString().replaceAll(RegExp(r'\s+'), '_');
        // ignore: unused_local_variable
        final anchor = html.AnchorElement()
          ..href = url
          ..download = 'Suhan_Gautam_${companyClean}_Cover_Letter.docx'
          ..click();
        html.Url.revokeObjectUrl(url);

        await _updateJobStatus(jobId, 'COVER_LETTER_SAVED');
        _snack('Word document downloaded & status updated!');
      } else {
        _snack('DOCX generation failed: ${r.body}', isError: true);
      }
    } catch (e) {
      _snack('Error downloading: $e', isError: true);
    } finally {
      setState(() { _downloadingState[jobId] = false; });
    }
  }

  Future<void> _openJobUrl(Map<String, dynamic> job) async {
    final url = job['url'] as String?;
    if (url == null || url.isEmpty) {
      _snack('No application URL available', isError: true);
      return;
    }
    final uri = Uri.parse(url);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } else {
      _snack('Could not open: $url', isError: true);
    }
  }

  void _snack(String msg, {bool isError = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg),
      backgroundColor: isError ? Colors.redAccent : const Color(0xFF10B981),
      behavior: SnackBarBehavior.floating,
      duration: Duration(seconds: isError ? 4 : 2),
    ));
  }

  void _showApiSettingsDialog() {
    final controller = TextEditingController(text: _baseUrl);
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1E293B),
        title: const Text('Configure Backend API URL', style: TextStyle(color: Color(0xFF38BDF8))),
        content: TextField(
          controller: controller,
          style: const TextStyle(color: Colors.white),
          decoration: InputDecoration(
            hintText: 'https://jobhunt-zgyu.onrender.com',
            hintStyle: const TextStyle(color: Color(0xFF64748B)),
            filled: true,
            fillColor: const Color(0xFF0F172A),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel', style: TextStyle(color: Color(0xFF64748B)))),
          ElevatedButton(
            onPressed: () { setState(() { _customApiUrl = controller.text.trim(); }); Navigator.pop(ctx); _fetchJobs(); },
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF38BDF8), foregroundColor: const Color(0xFF0F172A)),
            child: const Text('Save & Connect', style: TextStyle(fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  // ── Helpers ─────────────────────────────────────────────────────────────
  Color _getPriorityColor(int score) {
    if (score >= 90) return const Color(0xFF10B981);
    if (score >= 70) return const Color(0xFFF59E0B);
    return const Color(0xFF64748B);
  }

  // ── Build ───────────────────────────────────────────────────────────────
  @override
  Widget build(BuildContext context) {
    final int total = _jobs.length;
    final int applied = _jobs.where((j) => (j['status'] ?? '').toString().toUpperCase() == 'APPLIED').length;
    final int withLetters = _jobs.where((j) {
      final s = (j['status'] ?? '').toString().toUpperCase();
      return s == 'COVER_LETTER_GENERATED' || s == 'COVER_LETTER_SAVED';
    }).length;

    return Scaffold(
      appBar: AppBar(
        backgroundColor: const Color(0xFF1E293B),
        elevation: 0,
        title: const Row(children: [
          Icon(Icons.rocket_launch, color: Color(0xFF38BDF8), size: 24),
          SizedBox(width: 10),
          Text('JobHunt Reviewer', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: Colors.white)),
        ]),
        actions: [
          IconButton(icon: const Icon(Icons.settings, color: Color(0xFF38BDF8)), onPressed: _showApiSettingsDialog, tooltip: 'API Settings'),
          IconButton(icon: const Icon(Icons.refresh, color: Color(0xFF38BDF8)), onPressed: _fetchJobs, tooltip: 'Refresh'),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF38BDF8)))
          : _error != null
              ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(Icons.cloud_off, size: 64, color: Colors.redAccent),
                    const SizedBox(height: 16),
                    Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.redAccent, fontSize: 15)),
                    const SizedBox(height: 20),
                    Wrap(spacing: 12, children: [
                      ElevatedButton.icon(onPressed: _showApiSettingsDialog, icon: const Icon(Icons.settings, size: 18), label: const Text('Configure'),
                        style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF1E293B), foregroundColor: const Color(0xFF38BDF8), side: const BorderSide(color: Color(0xFF38BDF8)))),
                      ElevatedButton.icon(onPressed: _fetchJobs, icon: const Icon(Icons.refresh, size: 18), label: const Text('Retry'),
                        style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF38BDF8), foregroundColor: const Color(0xFF0F172A))),
                    ]),
                  ],
                )))
              : Column(children: [
                  // ── Stats Bar ────────────────────────────
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
                    color: const Color(0xFF1E293B),
                    child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                      _stat('Total', '$total', Icons.format_list_bulleted, const Color(0xFF38BDF8)),
                      _stat('Letters', '$withLetters', Icons.auto_awesome, const Color(0xFFF59E0B)),
                      _stat('Applied', '$applied', Icons.check_circle, const Color(0xFF10B981)),
                    ]),
                  ),
                  const Divider(height: 1, color: Color(0xFF334155)),
                  // ── Job List ─────────────────────────────
                  Expanded(child: RefreshIndicator(
                    onRefresh: _fetchJobs,
                    color: const Color(0xFF38BDF8),
                    child: ListView.builder(
                      padding: const EdgeInsets.all(16),
                      itemCount: _jobs.length,
                      itemBuilder: (context, index) => _buildJobCard(_jobs[index]),
                    ),
                  )),
                ]),
    );
  }

  // ── Job Card ────────────────────────────────────────────────────────────
  Widget _buildJobCard(Map<String, dynamic> job) {
    final String jobId = job['id'];
    final int priority = job['priority_score'] ?? 0;
    final String title = job['title'] ?? 'Untitled';
    final String company = job['company'] ?? 'Unknown';
    final String location = job['location'] ?? 'Sydney';
    final String status = (job['status'] ?? 'NEW').toString().toUpperCase();
    final bool isGenerating = _generatingState[jobId] ?? false;
    final bool isDownloading = _downloadingState[jobId] ?? false;
    final bool isExpanded = _expandedCards[jobId] ?? false;
    final sm = getStatusMeta(status);

    final bool isApplied = status == 'APPLIED' || status == 'INTERVIEW' || status == 'OFFER';
    final bool hasCoverLetter = status == 'COVER_LETTER_GENERATED' || status == 'COVER_LETTER_SAVED' || _coverLetters.containsKey(jobId);
    final bool isNew = status == 'NEW' || status == 'REVIEWED';

    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      curve: Curves.easeInOut,
      margin: const EdgeInsets.only(bottom: 14),
      child: Card(
        color: isApplied ? const Color(0xFF0D2818) : const Color(0xFF1E293B),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            // ── Header row ──────────────────────────
            Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              // Priority badge
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: _getPriorityColor(priority).withOpacity(0.15),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: _getPriorityColor(priority), width: 1.5),
                ),
                child: Column(children: [
                  Text('$priority', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: _getPriorityColor(priority))),
                  const Text('PRIORITY', style: TextStyle(fontSize: 8, fontWeight: FontWeight.w600, color: Color(0xFF94A3B8))),
                ]),
              ),
              const SizedBox(width: 14),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.white)),
                const SizedBox(height: 2),
                Text(company, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: Color(0xFF38BDF8))),
                const SizedBox(height: 6),
                Row(children: [
                  const Icon(Icons.location_on, size: 14, color: Color(0xFF64748B)),
                  const SizedBox(width: 2),
                  Text(location, style: const TextStyle(fontSize: 12, color: Color(0xFF94A3B8))),
                ]),
              ])),
              // Status badge
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(color: sm.bgColor, borderRadius: BorderRadius.circular(8), border: Border.all(color: sm.color.withOpacity(0.5))),
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  Icon(sm.icon, size: 13, color: sm.color),
                  const SizedBox(width: 4),
                  Text(sm.label, style: TextStyle(fontSize: 9, fontWeight: FontWeight.bold, color: sm.color, letterSpacing: 0.5)),
                ]),
              ),
            ]),

            const SizedBox(height: 14),
            const Divider(height: 1, color: Color(0xFF334155)),
            const SizedBox(height: 12),

            // ── Action Buttons based on status ──────
            if (isNew) ...[
              _actionButton(
                icon: isGenerating
                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF0F172A)))
                    : const Icon(Icons.auto_awesome, size: 18),
                label: isGenerating ? 'Generating via Groq...' : 'Draft Cover Letter',
                color: const Color(0xFF38BDF8),
                onPressed: isGenerating ? null : () => _draftCoverLetter(job),
              ),
            ],

            if (hasCoverLetter) ...[
              // ── Cover Letter Editor ─────────────
              GestureDetector(
                onTap: () => setState(() { _expandedCards[jobId] = !isExpanded; }),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: const Color(0xFF0F172A),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: const Color(0xFF334155)),
                  ),
                  child: Row(children: [
                    const Icon(Icons.edit_document, size: 16, color: Color(0xFFF59E0B)),
                    const SizedBox(width: 8),
                    const Expanded(child: Text('Cover Letter Editor', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFFE2E8F0)))),
                    Icon(isExpanded ? Icons.keyboard_arrow_up : Icons.keyboard_arrow_down, color: const Color(0xFF64748B)),
                  ]),
                ),
              ),

              if (isExpanded && _coverLetterControllers.containsKey(jobId)) ...[
                const SizedBox(height: 8),
                Container(
                  constraints: const BoxConstraints(maxHeight: 250),
                  decoration: BoxDecoration(
                    color: const Color(0xFF0F172A),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: const Color(0xFF334155)),
                  ),
                  child: TextField(
                    controller: _coverLetterControllers[jobId],
                    maxLines: null,
                    style: const TextStyle(fontSize: 13, height: 1.6, color: Color(0xFFF1F5F9), fontFamily: 'monospace'),
                    decoration: const InputDecoration(
                      contentPadding: EdgeInsets.all(12),
                      border: InputBorder.none,
                      hintText: 'Edit your cover letter here...',
                      hintStyle: TextStyle(color: Color(0xFF475569)),
                    ),
                  ),
                ),
              ],

              const SizedBox(height: 10),
              // ── Button row ─────────────────────
              Wrap(spacing: 8, runSpacing: 8, children: [
                _smallActionButton(
                  icon: isDownloading
                      ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF0F172A)))
                      : const Icon(Icons.download, size: 16),
                  label: 'Save & Download .docx',
                  color: const Color(0xFF06B6D4),
                  onPressed: isDownloading ? null : () => _downloadDocx(job),
                ),
                _smallActionButton(
                  icon: isGenerating
                      ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF0F172A)))
                      : const Icon(Icons.refresh, size: 16),
                  label: 'Regenerate',
                  color: const Color(0xFFF59E0B),
                  onPressed: isGenerating ? null : () => _draftCoverLetter(job),
                ),
                _smallActionButton(
                  icon: const Icon(Icons.open_in_new, size: 16),
                  label: 'Apply',
                  color: const Color(0xFF3B82F6),
                  onPressed: () => _openJobUrl(job),
                ),
                _smallActionButton(
                  icon: const Icon(Icons.copy, size: 16),
                  label: 'Copy',
                  color: const Color(0xFF8B5CF6),
                  onPressed: () {
                    final text = _coverLetterControllers[jobId]?.text ?? '';
                    Clipboard.setData(ClipboardData(text: text));
                    _snack('Copied to clipboard!');
                  },
                ),
              ]),
              const SizedBox(height: 10),
              // ── Mark as Applied ────────────────
              if (status != 'APPLIED')
                _actionButton(
                  icon: const Icon(Icons.check_circle_outline, size: 18),
                  label: 'Mark as Applied',
                  color: const Color(0xFF10B981),
                  onPressed: () async {
                    await _updateJobStatus(jobId, 'APPLIED');
                    _snack('Marked as applied: $company');
                  },
                ),
            ],

            if (isApplied) ...[
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                decoration: BoxDecoration(
                  color: const Color(0xFF064E3B),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: const Color(0xFF10B981).withOpacity(0.3)),
                ),
                child: Row(children: [
                  const Icon(Icons.check_circle, size: 18, color: Color(0xFF6EE7B7)),
                  const SizedBox(width: 8),
                  Expanded(child: Text('Applied to $company', style: const TextStyle(color: Color(0xFF6EE7B7), fontWeight: FontWeight.w600, fontSize: 13))),
                  TextButton(
                    onPressed: () => _openJobUrl(job),
                    child: const Text('View Listing', style: TextStyle(color: Color(0xFF38BDF8), fontSize: 12)),
                  ),
                ]),
              ),
            ],
          ]),
        ),
      ),
    );
  }

  // ── Reusable Button Widgets ─────────────────────────────────────────────
  Widget _actionButton({required Widget icon, required String label, required Color color, VoidCallback? onPressed}) {
    return SizedBox(
      width: double.infinity,
      child: ElevatedButton.icon(
        onPressed: onPressed,
        icon: icon,
        label: Text(label, style: const TextStyle(fontWeight: FontWeight.bold)),
        style: ElevatedButton.styleFrom(
          backgroundColor: color,
          foregroundColor: const Color(0xFF0F172A),
          padding: const EdgeInsets.symmetric(vertical: 12),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        ),
      ),
    );
  }

  Widget _smallActionButton({required Widget icon, required String label, required Color color, VoidCallback? onPressed}) {
    return ElevatedButton.icon(
      onPressed: onPressed,
      icon: icon,
      label: Text(label, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 11)),
      style: ElevatedButton.styleFrom(
        backgroundColor: color,
        foregroundColor: const Color(0xFF0F172A),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
        minimumSize: const Size(0, 36),
      ),
    );
  }

  Widget _stat(String label, String value, IconData icon, Color color) {
    return Row(children: [
      Icon(icon, size: 16, color: color),
      const SizedBox(width: 6),
      Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: const TextStyle(fontSize: 10, color: Color(0xFF64748B))),
        Text(value, style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: color)),
      ]),
    ]);
  }
}
