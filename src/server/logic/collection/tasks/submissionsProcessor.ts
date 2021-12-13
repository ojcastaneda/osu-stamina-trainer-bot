import { createSubmission, deleteSubmission, retrieveSubmissionFile } from '../submissions.logic';
import { updateCollectionFile } from '../collectionFile';
import { writeFile, existsSync, mkdirSync } from 'fs';
import Submission from '../../../models/submission';
import Beatmap from '../../../models/beatmap';
import fileManager from '../../fileManager';
import BaseTask from './baseTask';
import { promisify } from 'util';
import fetch from 'cross-fetch';
import PQueue from 'p-queue';

const writeFileAsync = promisify(writeFile);

class SubmissionsProcessor extends BaseTask {
	public approveSubmissions = async () => {
		console.info('Approve submissions start');
		if (!existsSync('beatmaps')) mkdirSync('beatmaps');
		await this.osuService.retrieveToken();
		const submissions = await Submission.retrieveSubmissions(['id'], [], [`approved_status = 'pending_approved'`]);
		const submissionsToProcess: boolean[] = [];
		const osuDownloadQueue = new PQueue({ interval: 5000, intervalCap: 1, concurrency: 1 });
		for (let index = 0; index < submissions.length; index++)
			osuDownloadQueue
				.add(async () => {
					try {
						const downloadResult = await this.downloadSubmissionFile(submissions[index].id!);
						if (downloadResult === 'delete') {
							await deleteSubmission(submissions[index].id!);
							submissionsToProcess[index] = false;
						} else if ('process') submissionsToProcess[index] = true;
						else submissionsToProcess[index] = false;
					} catch (error) {
						console.warn(error);
					}
				})
				.catch(error => console.warn(error));
		await osuDownloadQueue.onIdle();
		this.promiseQueue
			.addAll(
				submissions.map((submission, index) => async () => {
					try {
						if (!submissionsToProcess[index]) return;
						const beatmap = await this.osuService.retrieveBeatmap(submission.id!);
						if (beatmap === undefined) return;
						await writeFileAsync(`beatmaps/${submission.id!}.osu`, (await retrieveSubmissionFile(submission.id!))!);
						if ((await this.processBeatmap(beatmap, true)) && beatmap.ranked_status === 'ranked')
							(await Submission.deleteSubmission(beatmap.id!)) !== 0 && (await fileManager.deleteFile(`beatmaps/${beatmap.id!}.osu`));
						else await deleteSubmission(submission.id!);
					} catch (error) {
						console.warn(error);
					}
				})
			)
			.catch(error => console.warn(error));
		await this.promiseQueue.onIdle();
		await updateCollectionFile();
		console.info('Approve submissions end');
	};

	public checkSubmissionsLastUpdate = async () => {
		console.info('Submissions update start');
		await this.osuService.retrieveToken();
		const beatmaps = await Beatmap.retrieveBeatmaps(['id', 'last_updated'], [], [`ranked_status != 'ranked'`]);
		this.promiseQueue
			.addAll(
				beatmaps.map(beatmap => async () => {
					try {
						const retrievedBeatmap = await this.osuService.retrieveBeatmap(beatmap.id!);
						if (retrievedBeatmap === undefined) await deleteSubmission(beatmap.id!);
						else if (retrievedBeatmap.last_updated! > new Date(beatmap.last_updated!)) {
							await deleteSubmission(beatmap.id!);
							await createSubmission(beatmap.id!);
						}
					} catch (error) {
						console.warn(error);
					}
				})
			)
			.catch(error => console.warn(error));
		await this.promiseQueue.onIdle();
		await updateCollectionFile();
		console.info('Submissions update end');
	};

	private downloadSubmissionFile = async (id: number): Promise<string> => {
		const response = await fetch(`https://osu.ppy.sh/osu/${id}`);
		if (response.ok) {
			const file = await response.text();
			if (!file) return 'delete';
			await fileManager.uploadFile(file, `beatmaps/${id}.osu`);
			return 'process';
		}
		return 'postponed';
	};
}

export default SubmissionsProcessor;
