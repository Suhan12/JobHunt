import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;

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

  String get _baseUrl {
    return 'http://localhost:4000';
  }

  @override
  void initState() {
    super.initState();
    _fetchJobs();
  }

  Future<void> _fetchJobs() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final response = await http.get(Uri.parse('$_baseUrl/jobs'));
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body) as List;
        setState(() {
          _jobs = data;
          _isLoading = false;
        });
      } else {
        setState(() {
          _error = 'Failed to load jobs (HTTP ${response.statusCode})';
          _isLoading = false;
        });
      }
    } catch (e) {
      setState(() {
        _error = 'Error connecting to API: $e';
        _isLoading = false;
      });
    }
  }

  Future<void> _draftCoverLetter(Map<String, dynamic> job) async {
    final String jobId = job['id'];
    setState(() {
      _generatingState[jobId] = true;
    });

    try {
      final response = await http.post(
        Uri.parse('$_baseUrl/generate'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'jobId': jobId}),
      );

      if (response.statusCode == 200) {
        final result = jsonDecode(response.body);
        _showCoverLetterDialog(job, result);
        _fetchJobs();
      } else {
        _showErrorSnackBar('Generation failed: ${response.body}');
      }
    } catch (e) {
      _showErrorSnackBar('Error generating cover letter: $e');
    } finally {
      setState(() {
        _generatingState[jobId] = false;
      });
    }
  }

  void _showErrorSnackBar(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: Colors.redAccent,
      ),
    );
  }

  void _showCoverLetterDialog(Map<String, dynamic> job, Map<String, dynamic> result) {
    final String coverLetter = result['coverLetter'] ?? '';
    final String hiringManager = result['hiringManager'] ?? 'Hiring Team';
    final int charCount = result['charCount'] ?? coverLetter.length;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF1E293B),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) {
        return Padding(
          padding: EdgeInsets.only(
            top: 24,
            left: 24,
            right: 24,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 24,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          job['title'] ?? 'Job Application',
                          style: const TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.bold,
                            color: Color(0xFF38BDF8),
                          ),
                        ),
                        Text(
                          job['company'] ?? '',
                          style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 14),
                        ),
                      ],
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: const Color(0xFF065F46),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: const [
                        Icon(Icons.check_circle, size: 14, color: Color(0xFF6EE7B7)),
                        SizedBox(width: 4),
                        Text('Applied', style: TextStyle(color: Color(0xFF6EE7B7), fontSize: 12, fontWeight: FontWeight.bold)),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFF0F172A),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: const Color(0xFF334155)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.person_search, color: Color(0xFF38BDF8), size: 18),
                    const SizedBox(width: 8),
                    Text(
                      'Addressed to: $hiringManager',
                      style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13, color: Color(0xFFE2E8F0)),
                    ),
                    const Spacer(),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(
                        color: const Color(0xFF1E3A5F),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        '$charCount chars',
                        style: const TextStyle(color: Color(0xFF7DD3FC), fontSize: 12, fontWeight: FontWeight.bold),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              const Text(
                'Drafted Cover Letter (Groq Llama 3.3 70B):',
                style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13, color: Color(0xFF94A3B8)),
              ),
              const SizedBox(height: 8),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: const Color(0xFF0F172A),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0xFF334155)),
                ),
                child: SelectableText(
                  coverLetter,
                  style: const TextStyle(
                    fontSize: 14,
                    height: 1.5,
                    color: Color(0xFFF1F5F9),
                    fontFamily: 'monospace',
                  ),
                ),
              ),
              const SizedBox(height: 20),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () {
                        Clipboard.setData(ClipboardData(text: coverLetter));
                        Navigator.pop(ctx);
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Cover letter copied to clipboard!')),
                        );
                      },
                      icon: const Icon(Icons.copy, size: 18),
                      label: const Text('Copy to Clipboard'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: const Color(0xFF38BDF8),
                        side: const BorderSide(color: Color(0xFF38BDF8)),
                        padding: const EdgeInsets.symmetric(vertical: 14),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: ElevatedButton(
                      onPressed: () => Navigator.pop(ctx),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF38BDF8),
                        foregroundColor: const Color(0xFF0F172A),
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                      ),
                      child: const Text('Done', style: TextStyle(fontWeight: FontWeight.bold)),
                    ),
                  ),
                ],
              ),
            ],
          ),
        );
      },
    );
  }

  Color _getPriorityColor(int score) {
    if (score >= 90) return const Color(0xFF10B981);
    if (score >= 70) return const Color(0xFFF59E0B);
    return const Color(0xFF64748B);
  }

  @override
  Widget build(BuildContext context) {
    final int totalJobs = _jobs.length;
    final int appliedCount = _jobs.where((j) => j['status'] == 'applied').length;

    return Scaffold(
      appBar: AppBar(
        backgroundColor: const Color(0xFF1E293B),
        elevation: 0,
        title: Row(
          children: const [
            Icon(Icons.rocket_launch, color: Color(0xFF38BDF8), size: 24),
            SizedBox(width: 10),
            Text(
              'JobHunt Reviewer',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: Colors.white),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: Color(0xFF38BDF8)),
            onPressed: _fetchJobs,
            tooltip: 'Refresh Listings',
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF38BDF8)))
          : _error != null
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.cloud_off, size: 64, color: Colors.redAccent),
                      const SizedBox(height: 16),
                      Text(_error!, style: const TextStyle(color: Colors.redAccent, fontSize: 16)),
                      const SizedBox(height: 16),
                      ElevatedButton(
                        onPressed: _fetchJobs,
                        style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF38BDF8)),
                        child: const Text('Retry'),
                      ),
                    ],
                  ),
                )
              : Column(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
                      color: const Color(0xFF1E293B),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          _buildStatItem('Total Listings', '$totalJobs', Icons.format_list_bulleted, const Color(0xFF38BDF8)),
                          _buildStatItem('Applied', '$appliedCount', Icons.check_circle, const Color(0xFF10B981)),
                          _buildStatItem('Sort Order', 'Priority Score ↓', Icons.sort, const Color(0xFFF59E0B)),
                        ],
                      ),
                    ),
                    const Divider(height: 1, color: Color(0xFF334155)),
                    Expanded(
                      child: RefreshIndicator(
                        onRefresh: _fetchJobs,
                        color: const Color(0xFF38BDF8),
                        child: ListView.builder(
                          padding: const EdgeInsets.all(16),
                          itemCount: _jobs.length,
                          itemBuilder: (context, index) {
                            final job = _jobs[index];
                            final String jobId = job['id'];
                            final int priorityScore = job['priority_score'] ?? 0;
                            final String title = job['title'] ?? 'Untitled';
                            final String company = job['company'] ?? 'Unknown Company';
                            final String location = job['location'] ?? 'Sydney';
                            final String status = job['status'] ?? 'new';
                            final bool isGenerating = _generatingState[jobId] ?? false;

                            return Card(
                              margin: const EdgeInsets.only(bottom: 14),
                              child: Padding(
                                padding: const EdgeInsets.all(16),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                          decoration: BoxDecoration(
                                            color: _getPriorityColor(priorityScore).withOpacity(0.15),
                                            borderRadius: BorderRadius.circular(8),
                                            border: Border.all(color: _getPriorityColor(priorityScore), width: 1.5),
                                          ),
                                          child: Column(
                                            children: [
                                              Text(
                                                '$priorityScore',
                                                style: TextStyle(
                                                  fontSize: 18,
                                                  fontWeight: FontWeight.bold,
                                                  color: _getPriorityColor(priorityScore),
                                                ),
                                              ),
                                              const Text(
                                                'PRIORITY',
                                                style: TextStyle(fontSize: 8, fontWeight: FontWeight.w600, color: Color(0xFF94A3B8)),
                                              ),
                                            ],
                                          ),
                                        ),
                                        const SizedBox(width: 14),
                                        Expanded(
                                          child: Column(
                                            crossAxisAlignment: CrossAxisAlignment.start,
                                            children: [
                                              Text(
                                                title,
                                                style: const TextStyle(
                                                  fontSize: 16,
                                                  fontWeight: FontWeight.bold,
                                                  color: Colors.white,
                                                ),
                                              ),
                                              const SizedBox(height: 2),
                                              Text(
                                                company,
                                                style: const TextStyle(
                                                  fontSize: 14,
                                                  fontWeight: FontWeight.w500,
                                                  color: Color(0xFF38BDF8),
                                                ),
                                              ),
                                              const SizedBox(height: 6),
                                              Row(
                                                children: [
                                                  const Icon(Icons.location_on, size: 14, color: Color(0xFF64748B)),
                                                  const SizedBox(width: 2),
                                                  Text(location, style: const TextStyle(fontSize: 12, color: Color(0xFF94A3B8))),
                                                  const SizedBox(width: 12),
                                                  Container(
                                                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                                    decoration: BoxDecoration(
                                                      color: const Color(0xFF0F172A),
                                                      borderRadius: BorderRadius.circular(4),
                                                    ),
                                                    child: Text(
                                                      status.toUpperCase(),
                                                      style: TextStyle(
                                                        fontSize: 10,
                                                        fontWeight: FontWeight.bold,
                                                        color: status == 'applied' ? const Color(0xFF10B981) : const Color(0xFF94A3B8),
                                                      ),
                                                    ),
                                                  ),
                                                ],
                                              ),
                                            ],
                                          ),
                                        ),
                                      ],
                                    ),
                                    const SizedBox(height: 14),
                                    const Divider(height: 1, color: Color(0xFF334155)),
                                    const SizedBox(height: 12),
                                    SizedBox(
                                      width: double.infinity,
                                      child: ElevatedButton.icon(
                                        onPressed: isGenerating ? null : () => _draftCoverLetter(job),
                                        icon: isGenerating
                                            ? const SizedBox(
                                                width: 16,
                                                height: 16,
                                                child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF0F172A)),
                                              )
                                            : const Icon(Icons.auto_awesome, size: 18),
                                        label: Text(
                                          isGenerating ? 'Generating via Groq...' : 'Draft Cover Letter',
                                          style: const TextStyle(fontWeight: FontWeight.bold),
                                        ),
                                        style: ElevatedButton.styleFrom(
                                          backgroundColor: status == 'applied' ? const Color(0xFF10B981) : const Color(0xFF38BDF8),
                                          foregroundColor: const Color(0xFF0F172A),
                                          padding: const EdgeInsets.symmetric(vertical: 12),
                                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            );
                          },
                        ),
                      ),
                    ),
                  ],
                ),
    );
  }

  Widget _buildStatItem(String label, String value, IconData icon, Color color) {
    return Row(
      children: [
        Icon(icon, size: 16, color: color),
        const SizedBox(width: 6),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: const TextStyle(fontSize: 10, color: Color(0xFF64748B))),
            Text(value, style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: color)),
          ],
        ),
      ],
    );
  }
}
